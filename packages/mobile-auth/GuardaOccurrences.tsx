import {useEffect,useRef,useState} from "react";
import {Pressable,StyleSheet,Text,TextInput,View} from "react-native";
import {errorMessage,type Transport} from "../auth/client";
type Area={id:string;displayName:string};
type Occurrence={id:string;category:string;locationText:string;description:string;
 status:"open"|"in_progress"|"resolved";revision:number;createdAt:string};
const categories=["apoio","transito","patrulhamento","outros"] as const;
function requestId(){return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
 const n=Math.floor(Math.random()*16);return(c==="x"?n:(n&3)|8).toString(16)})}
export default function GuardaOccurrences({transport,municipalities}:{
 transport:Transport;municipalities:Area[]}){
 const [mid,setMid]=useState(municipalities[0]?.id??"");
 const [items,setItems]=useState<Occurrence[]>([]),[category,setCategory]=useState("apoio");
 const [location,setLocation]=useState(""),[description,setDescription]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const idempotency=useRef<string|null>(null),revision=useRef(0);
 async function load(){
  const result=await transport.request("/guarda/query",{municipalityId:mid});
  if(!Array.isArray(result.items)||result.items.length>30||
   result.items.some(x=>!x||typeof x.id!=="string"||!["open","in_progress","resolved"].includes(x.status)||
    typeof x.description!=="string"||!Number.isSafeInteger(x.revision)))
    throw Error("INVALID_RESPONSE");
  setItems(result.items as Occurrence[]);
 }
 useEffect(()=>{
  const token=++revision.current;setItems([]);setError("");setNotice("");idempotency.current=null;
  if(mid)void transport.request("/guarda/query",{municipalityId:mid})
    .then(raw=>{if(token===revision.current&&Array.isArray(raw.items))setItems(raw.items as Occurrence[])})
    .catch(e=>{if(token===revision.current)setError(errorMessage(e))});
  return ()=>{revision.current++};
 },[transport,mid]);
 async function run(job:()=>Promise<void>){
  if(busy)return;setBusy(true);setError("");setNotice("");
  try{await job()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 const button=(label:string,fn:()=>void)=><Pressable accessibilityRole="button" disabled={busy}
   style={[styles.button,busy&&{opacity:.55}]} onPress={fn}><Text style={styles.white}>{label}</Text></Pressable>;
 function create(){
  void run(async()=>{
   const id=idempotency.current??requestId();idempotency.current=id;
   const result=await transport.request("/guarda/mutate",{operation:"create",municipalityId:mid,
    clientRequestId:id,category,locationText:location.trim(),description:description.trim()});
   if(typeof result.occurrenceId!=="string")throw Error("INVALID_RESPONSE");
   idempotency.current=null;setLocation("");setDescription("");await load();
   setNotice("Ocorrência registrada. A equipe pode acompanhar o andamento.");
  });
 }
 function update(item:Occurrence,operation:"start"|"resolve"){
  void run(async()=>{await transport.request("/guarda/mutate",{
    operation,municipalityId:mid,occurrenceId:item.id,revision:item.revision});
   await load();setNotice("Andamento confirmado pelo servidor.");
  });
 }
 return <View style={styles.root}>
  <Text style={styles.title}>Ocorrências da Guarda</Text>
  {municipalities.length>1&&municipalities.map(a=><View key={a.id}>
   {button(a.displayName,()=>setMid(a.id))}</View>)}
  <Text style={styles.subtitle}>Nova ocorrência</Text>
  <Text>Tipo</Text>
  {categories.map(c=><View key={c}>{button((category===c?"✓ ":"")+c,()=>setCategory(c))}</View>)}
  <TextInput accessibilityLabel="Local da ocorrência" placeholder="Local de referência"
    value={location} onChangeText={v=>{setLocation(v);idempotency.current=null}}
    maxLength={120} style={styles.input}/>
  <TextInput accessibilityLabel="Descrição da ocorrência" placeholder="Descreva o atendimento"
    value={description} onChangeText={v=>{setDescription(v);idempotency.current=null}}
    multiline maxLength={2000} style={[styles.input,{minHeight:80}]}/>
  {button("Registrar ocorrência",create)}
  {button("Atualizar ocorrências",()=>void run(load))}
  {!!error&&<Text accessibilityRole="alert">{error}</Text>}
  {!!notice&&<Text>{notice}</Text>}
  {items.map(it=><View key={it.id} style={styles.item}>
   <Text style={styles.subtitle}>{it.category} · {it.status}</Text>
   <Text>{it.locationText}</Text><Text>{it.description}</Text>
   {it.status==="open"&&button("Iniciar atendimento",()=>update(it,"start"))}
   {it.status==="in_progress"&&button("Concluir atendimento",()=>update(it,"resolve"))}
  </View>)}
  {items.length===0&&<Text>Não há ocorrências neste município.</Text>}
 </View>;
}
const styles=StyleSheet.create({
 root:{padding:12,gap:8,backgroundColor:"#eef3f6",borderRadius:12,marginTop:10},
 title:{fontSize:19,fontWeight:"700",color:"#0d3042"},subtitle:{fontSize:15,fontWeight:"700"},
 input:{padding:10,backgroundColor:"#fff",borderRadius:8,borderWidth:1,borderColor:"#bbccd3"},
 button:{backgroundColor:"#153f5a",padding:10,borderRadius:8},white:{color:"#fff",fontWeight:"600"},
 item:{padding:12,borderColor:"#c4d1d8",borderWidth:1,borderRadius:10,gap:4}
});
