import {useEffect,useRef,useState} from "react";
import {ActivityIndicator,Pressable,StyleSheet,Text,TextInput,View} from "react-native";
import {errorMessage,type Transport} from "../auth/client";
type City={id:string;displayName:string};
type Case={id:string;kind:string;title:string;description:string;locationText:string|null;occurredAt:string|null;status:string;revision:number;createdAt:string};
const names:Record<string,string>={ocorrencia:"Ocorrência",apoio:"Apoio",orientacao:"Orientação",outro:"Outro"};
function uuid(){return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
 const v=Math.floor(Math.random()*16);return (c==="x"?v:(v&3)|8).toString(16)})}
export default function GuardOccurrences({transport,municipalities}:{transport:Transport;municipalities:City[]}){
 const [city,setCity]=useState(municipalities[0]?.id??""),[cases,setCases]=useState<Case[]>([]);
 const [kind,setKind]=useState("ocorrencia"),[title,setTitle]=useState(""),[description,setDescription]=useState(""),[location,setLocation]=useState("");
 const [history,setHistory]=useState<{id:string;items:{code:string;revision:number;createdAt:string}[]}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const pending=useRef<{id:string;occurredAt:string}|null>(null);
 async function refresh(){
  const page=await transport.request("/guarda/query",{municipalityId:city});
  if(!Array.isArray(page.items)||page.items.length>20||page.items.some((x:Case)=>typeof x.id!=="string"||typeof x.title!=="string"))
   throw Error("Resposta inválida");
  setCases(page.items as Case[]);
 }
 async function run(fn:()=>Promise<void>){
  if(busy)return;setBusy(true);setError("");setNotice("");
  try{await fn()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 useEffect(()=>{let active=true;setCases([]);if(!city)return;
  void transport.request("/guarda/query",{municipalityId:city})
   .then(v=>{if(active&&Array.isArray(v.items))setCases(v.items as Case[])})
   .catch(e=>{if(active)setError(errorMessage(e))});
  return()=>{active=false};
 },[transport,city]);
 return <View style={styles.wrap}><Text style={styles.header}>Guarda · Registro de ocorrências</Text>
 <Text style={styles.helper}>Ambiente de desenvolvimento. Não registre atendimentos ou pessoas reais.</Text>
 {municipalities.length>1&&municipalities.map(m=><Pressable key={m.id} onPress={()=>setCity(m.id)} accessibilityRole="button" style={styles.button}><Text style={styles.label}>{m.displayName}</Text></Pressable>)}
 <Text style={styles.label}>Tipo</Text>
 <View style={styles.row}>{Object.keys(names).map(k=><Pressable key={k} onPress={()=>{setKind(k);pending.current=null}} style={styles.small} accessibilityRole="button"><Text style={styles.label}>{names[k]}</Text></Pressable>)}</View>
 <Text style={styles.helper}>Selecionado: {names[kind]}</Text>
 <TextInput accessibilityLabel="Título da ocorrência" placeholder="Título" maxLength={120} value={title}
  onChangeText={v=>{setTitle(v);pending.current=null}} style={styles.field}/>
 <TextInput accessibilityLabel="Descrição da ocorrência" placeholder="Descrição objetiva" multiline maxLength={2000} value={description}
  onChangeText={v=>{setDescription(v);pending.current=null}} style={[styles.field,{minHeight:105}]}/>
 <TextInput accessibilityLabel="Local da ocorrência" placeholder="Rua, ponto de referência ou área (sem localização precisa de pessoas)" maxLength={160} value={location}
  onChangeText={v=>{setLocation(v);pending.current=null}} style={styles.field}/>
 <Pressable accessibilityRole="button" style={styles.button} disabled={busy||title.trim().length<8||description.trim().length<20||location.trim().length<5}
 onPress={()=>void run(async()=>{
  const attempt=pending.current??(pending.current={id:uuid(),occurredAt:new Date().toISOString()});
  const result=await transport.request("/guarda/mutate",{municipalityId:city,operation:"create",
   clientRequestId:attempt.id,kind,title:title.trim(),description:description.trim(),
   locationText:location.trim(),occurredAt:attempt.occurredAt});
  if(typeof result.occurrenceId!=="string")throw Error("Resposta inválida");
  pending.current=null;setTitle("");setDescription("");setLocation("");await refresh();setNotice("Registro confirmado no município.");
 })}><Text style={styles.buttonText}>Registrar ocorrência</Text></Pressable>
 <Pressable accessibilityRole="button" style={styles.small} disabled={busy} onPress={()=>void run(refresh)}>
  <Text style={styles.label}>Atualizar meus registros</Text></Pressable>
 {busy&&<ActivityIndicator color="#075e59"/>}
 {cases.length===0?<Text style={styles.helper}>Nenhum registro nesta página.</Text>:cases.map(c=><View key={c.id} style={styles.case}>
  <Text style={styles.label}>{names[c.kind]??c.kind} · {c.status==="open"?"Recebido":c.status==="in_review"?"Em análise":"Encerrado"}</Text>
  <Text style={styles.label}>{c.title}</Text><Text style={styles.helper}>{c.description}</Text>
  <Text style={styles.helper}>Local: {c.locationText??"Não registrado"} · Data/hora: {new Date(c.occurredAt??c.createdAt).toLocaleString("pt-BR")}</Text>
  <Pressable accessibilityRole="button" style={styles.small} disabled={busy} onPress={()=>void run(async()=>{
    const result=await transport.request("/guarda/history",{municipalityId:city,occurrenceId:c.id});
    if(!Array.isArray(result.items))throw Error("Resposta inválida");
    setHistory({id:c.id,items:result.items as {code:string;revision:number;createdAt:string}[]});
  })}><Text style={styles.label}>Consultar histórico</Text></Pressable>
  {history?.id===c.id&&history.items.map(ev=><Text key={ev.revision} style={styles.helper}>
    {ev.code} · revisão {ev.revision} · {new Date(ev.createdAt).toLocaleString("pt-BR")}
  </Text>)}
  <Text style={styles.helper}>Registro {c.id.slice(0,8)} · revisão {c.revision}</Text>
 </View>)}
 {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
 {!!notice&&<Text accessibilityLiveRegion="polite" style={styles.helper}>{notice}</Text>}
 </View>;
}
const styles=StyleSheet.create({wrap:{gap:12,paddingVertical:20},header:{fontSize:21,fontWeight:"800",color:"#194239"},
 helper:{color:"#546b61",fontSize:13},label:{color:"#183c35",fontWeight:"700"},
 row:{flexDirection:"row",flexWrap:"wrap",gap:8},button:{backgroundColor:"#075e59",padding:14,borderRadius:10},
 buttonText:{color:"white",fontWeight:"700",textAlign:"center"},small:{backgroundColor:"#e7f1ec",padding:10,borderRadius:8},
 field:{backgroundColor:"white",borderColor:"#9ab8a8",borderWidth:1,borderRadius:9,padding:12,color:"#15392f"},
 case:{backgroundColor:"#f4f8f5",padding:13,borderRadius:9,gap:7},error:{color:"#923628"}});
