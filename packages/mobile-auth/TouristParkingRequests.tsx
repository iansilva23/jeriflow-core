import {useEffect,useRef,useState} from "react";
import {ActivityIndicator,Pressable,StyleSheet,Text,TextInput,View} from "react-native";
import {errorMessage,type Transport} from "../auth/client";

type City={id:string;displayName:string};
type ServiceRequest={id:string;vehiclePlate:string;areaText:string;serviceDay:string;description:string;
 status:"requested"|"in_review"|"answered"|"rejected";revision:number;adminResponse:string|null;createdAt:string};
type Event={code:string;revision:number;createdAt:string};
const statuses:Record<ServiceRequest["status"],string>={
 requested:"Recebida",in_review:"Em análise",answered:"Respondida",rejected:"Não atendida"
};
function requestUuid(){
 return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
  const n=Math.floor(Math.random()*16);return (c==="x"?n:(n&3)|8).toString(16);
 });
}
export default function TouristParkingRequests({transport,municipalities}:{transport:Transport;municipalities:City[]}){
 const [municipalityId,setMunicipalityId]=useState(municipalities[0]?.id??"");
 const [plate,setPlate]=useState(""),[area,setArea]=useState(""),[day,setDay]=useState(""),[details,setDetails]=useState("");
 const [items,setItems]=useState<ServiceRequest[]>([]),[history,setHistory]=useState<{id:string;items:Event[]}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const pending=useRef<string|null>(null);
 function change(setter:(value:string)=>void,value:string){setter(value);pending.current=null;}
 async function load(){
  if(!municipalityId)return;
  const result=await transport.request("/parking/requests/query",{municipalityId,scope:"mine"});
  if(!Array.isArray(result.items)||result.items.length>20||
   result.items.some((x:ServiceRequest)=>!x||typeof x.id!=="string"||typeof x.serviceDay!=="string"||
     !Object.hasOwn(statuses,x.status)))throw Error("Resposta inválida");
  setItems(result.items as ServiceRequest[]);
 }
 async function run(action:()=>Promise<void>){
  if(busy)return;
  setBusy(true);setError("");setMessage("");
  try{await action()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 useEffect(()=>{
  let active=true;setItems([]);setHistory(null);
  if(!municipalityId)return;
  void transport.request("/parking/requests/query",{municipalityId,scope:"mine"})
   .then(res=>{if(active&&Array.isArray(res.items))setItems(res.items as ServiceRequest[])})
   .catch(err=>{if(active)setError(errorMessage(err))});
  return()=>{active=false};
 },[transport,municipalityId]);
 const normalizedPlate=plate.trim().toUpperCase();
 const validDay=/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+"T00:00:00.000Z"))&&
   new Date(day+"T00:00:00.000Z").toISOString().slice(0,10)===day;
 const valid=/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(normalizedPlate)&&
  area.trim().length>=5&&details.trim().length>=10&&validDay;
 return <View style={styles.root}>
  <Text style={styles.title}>Atendimento de estacionamento</Text>
  <Text style={styles.hint}>Solicitações registradas para análise. Isto NÃO é reserva de vaga, diária paga,
   comprovante da TTS nem permissão para estacionar. Use somente dados fictícios neste ambiente.</Text>
  {municipalities.length>1&&municipalities.map(city=><Pressable key={city.id}
   accessibilityRole="button" onPress={()=>{setMunicipalityId(city.id);pending.current=null}}
   style={styles.secondary}><Text>{city.displayName}</Text></Pressable>)}
  <Text style={styles.label}>Placa do veículo</Text>
  <TextInput accessibilityLabel="Placa" autoCapitalize="characters" maxLength={7}
   style={styles.field} value={plate} placeholder="ABC1D23"
   onChangeText={v=>change(setPlate,v.toUpperCase())}/>
  <Text style={styles.label}>Área ou ponto de referência</Text>
  <TextInput accessibilityLabel="Área de estacionamento" maxLength={120} style={styles.field}
   value={area} onChangeText={v=>change(setArea,v)} placeholder="Localidade do atendimento"/>
  <Text style={styles.label}>Data solicitada (AAAA-MM-DD)</Text>
  <TextInput accessibilityLabel="Data solicitada" maxLength={10} keyboardType="numbers-and-punctuation"
   value={day} onChangeText={v=>change(setDay,v)} style={styles.field} placeholder="2026-10-10"/>
  <Text style={styles.label}>Descrição da solicitação</Text>
  <TextInput accessibilityLabel="Descrição da solicitação" style={[styles.field,{minHeight:85}]}
   multiline maxLength={1000} value={details} onChangeText={v=>change(setDetails,v)}
   placeholder="Descreva a necessidade sem incluir dados pessoais desnecessários"/>
  <Pressable accessibilityRole="button" style={styles.primary} disabled={busy||!valid||!municipalityId}
   onPress={()=>void run(async()=>{
    const result=await transport.request("/parking/requests/mutate",{municipalityId,operation:"create",
      clientRequestId:pending.current??(pending.current=requestUuid()),
      vehiclePlate:normalizedPlate,areaText:area.trim(),serviceDay:day,description:details.trim()});
    if(result.status!=="requested"||result.authorizationIssued!==false||result.paymentRegistered!==false)
     throw Error("Resposta inválida");
    pending.current=null;setPlate("");setArea("");setDay("");setDetails("");
    await load();setMessage("Solicitação registrada para análise, sem autorização de estacionamento.");
   })}><Text style={styles.primaryLabel}>Enviar solicitação</Text></Pressable>
  <Pressable accessibilityRole="button" style={styles.secondary} disabled={busy}
   onPress={()=>void run(load)}><Text style={styles.label}>Atualizar solicitações</Text></Pressable>
  {busy&&<ActivityIndicator color="#075e59"/>}
  {items.map(item=><View key={item.id} style={styles.card}>
   <Text style={styles.label}>{statuses[item.status]} · {item.serviceDay}</Text>
   <Text>{item.vehiclePlate} · {item.areaText}</Text>
   <Text style={styles.hint}>{item.description}</Text>
   {!!item.adminResponse&&<Text style={styles.label}>Resposta: {item.adminResponse}</Text>}
   <Pressable accessibilityRole="button" style={styles.secondary} disabled={busy} onPress={()=>void run(async()=>{
    const result=await transport.request("/parking/requests/history",{municipalityId,requestId:item.id});
    if(!Array.isArray(result.items))throw Error("Resposta inválida");
    setHistory({id:item.id,items:result.items as Event[]});
   })}><Text>Ver histórico</Text></Pressable>
   {history?.id===item.id&&history.items.map(ev=><Text key={ev.revision} style={styles.hint}>
    {ev.code} · revisão {ev.revision} · {new Date(ev.createdAt).toLocaleString("pt-BR")}
   </Text>)}
  </View>)}
  {items.length===0&&<Text style={styles.hint}>Nenhuma solicitação nesta página.</Text>}
  {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  {!!message&&<Text accessibilityLiveRegion="polite" style={styles.hint}>{message}</Text>}
 </View>;
}
const styles=StyleSheet.create({
 root:{gap:10,paddingVertical:18},title:{fontSize:20,fontWeight:"800",color:"#194239"},
 hint:{fontSize:13,color:"#53675d"},label:{fontWeight:"700",color:"#234238"},
 field:{backgroundColor:"#fff",borderRadius:8,borderWidth:1,borderColor:"#a6bab0",padding:12,color:"#183c35"},
 primary:{padding:14,backgroundColor:"#075e59",borderRadius:9},
 primaryLabel:{color:"#fff",fontWeight:"700",textAlign:"center"},
 secondary:{backgroundColor:"#e8f3ed",padding:11,borderRadius:8},
 card:{backgroundColor:"#f2f7f4",padding:12,borderRadius:9,gap:7},error:{color:"#923628"}
});
