import {useEffect,useRef,useState} from "react";
import {Pressable,Text,View,StyleSheet} from "react-native";
import type {Transport} from "../auth/client";
import {errorMessage} from "../auth/client";
type Area={id:string;displayName:string};
type Notice={id:string;protocolId:string;code:string;createdAt:string;read:boolean};
const labels:Record<string,string>={
 created:"Protocolo recebido",triaged:"Análise iniciada",responded:"Resposta disponível",
 contested:"Contestação registrada",closed:"Atendimento encerrado",new_request:"Novo protocolo na Ouvidoria"
};
export default function NoticeFeed({transport,municipalities}:{transport:Transport;municipalities:Area[]}){
 const [mid,setMid]=useState(municipalities[0]?.id??""),[items,setItems]=useState<Notice[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const revision=useRef(0);
 async function load(){
  setError("");
  try{
   const raw=await transport.request("/ouvidoria/notifications",{municipalityId:mid});
   if(!Array.isArray(raw.items)||raw.items.length>50||raw.items.some(x=>
     !x||typeof x.id!=="string"||typeof x.protocolId!=="string"||
     typeof x.code!=="string"||!Object.hasOwn(labels,x.code)||
     typeof x.createdAt!=="string"||typeof x.read!=="boolean"))throw Error("INVALID_RESPONSE");
   setItems(raw.items as Notice[]);
  }catch(e){setError(errorMessage(e))}
 }
 useEffect(()=>{
  const stamp=++revision.current;setItems([]);setError("");
  if(mid)void transport.request("/ouvidoria/notifications",{municipalityId:mid})
   .then(raw=>{
    if(!Array.isArray(raw.items)||raw.items.length>50)throw Error("INVALID_RESPONSE");
    if(stamp===revision.current)setItems(raw.items as Notice[]);
   }).catch(e=>{if(stamp===revision.current)setError(errorMessage(e))});
  return ()=>{revision.current++};
 },[transport,mid]);
 async function read(id:string){
  if(busy)return;setBusy(true);setError("");
  try{
   await transport.request("/ouvidoria/notifications/read",{municipalityId:mid,notificationId:id});
   await load();
  }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 const btn=(label:string,click:()=>void)=><Pressable accessibilityRole="button" disabled={busy}
   onPress={click} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>;
 return <View style={styles.root}>
  <Text style={styles.title}>Notificações da Ouvidoria</Text>
  {municipalities.length>1&&municipalities.map(a=><View key={a.id}>{btn(a.displayName,()=>setMid(a.id))}</View>)}
  {btn("Atualizar notificações",()=>void load())}
  {!!error&&<Text accessibilityRole="alert">{error}</Text>}
  {items.length===0&&<Text>Nenhuma notificação cadastrada.</Text>}
  {items.map(n=><View key={n.id} style={styles.item}>
   <Text style={styles.text}>{labels[n.code]??"Atualização do protocolo"} · {new Date(n.createdAt).toLocaleDateString("pt-BR")}</Text>
   {!n.read&&btn("Marcar como lida",()=>void read(n.id))}
  </View>)}
 </View>;
}
const styles=StyleSheet.create({
 root:{padding:12,marginTop:12,borderRadius:12,backgroundColor:"#f4f7f9",gap:8},
 title:{fontSize:17,fontWeight:"700",color:"#0c2639"},
 item:{padding:10,borderTopColor:"#d0dbe2",borderTopWidth:1},
 text:{fontSize:14,color:"#163449",marginBottom:6},
 button:{paddingVertical:9,paddingHorizontal:12,backgroundColor:"#153f5a",borderRadius:8,marginVertical:3},
 buttonText:{color:"#fff",fontWeight:"600"}
});
