import {useEffect,useState} from "react";
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from "react-native";
import {errorMessage,type Transport} from "../auth/client";
import {protocolEventLabels,type ProtocolEventCode} from "../contracts/src/ouvidoria";
type Entry={id:string;protocolId:string;code:ProtocolEventCode;createdAt:string;readAt:string|null};
export default function CitizenNotices({transport,municipalityId}:{transport:Transport;municipalityId:string}){
 const [items,setItems]=useState<Entry[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [unread,setUnread]=useState(0),[total,setTotal]=useState(0),[next,setNext]=useState<string|null>(null);
 async function refresh(after?:string){
  if(!municipalityId)return;
  setBusy(true);setError("");
  try{
   const result=await transport.request("/ouvidoria/notices/query",{municipalityId,...(after?{after}:{})});
   if(!Array.isArray(result.items)||result.items.length>20||result.items.some((v:Entry)=>
     !v||typeof v.id!=="string"||typeof v.protocolId!=="string"||
     !Object.hasOwn(protocolEventLabels,v.code)||!(v.readAt===null||typeof v.readAt==="string")))
     throw Error("Resposta inválida");
   setItems(old=>after?[...old,...result.items as Entry[]]:result.items as Entry[]);
   setUnread(Number(result.unreadCount));setTotal(Number(result.totalCount));setNext(typeof result.next==='string'?result.next:null);
  }catch(e){setError(errorMessage(e));}finally{setBusy(false)}
 }
 useEffect(()=>{let current=true;setItems([]);if(!municipalityId)return;
  void transport.request("/ouvidoria/notices/query",{municipalityId})
   .then(v=>{if(current&&Array.isArray(v.items)){setItems(v.items as Entry[]);setUnread(Number(v.unreadCount??0));setTotal(Number(v.totalCount??0));setNext(typeof v.next==='string'?v.next:null)}})
   .catch(e=>{if(current)setError(errorMessage(e))});
  return()=>{current=false};
 },[transport,municipalityId]);
 async function seen(item:Entry){
  if(busy)return;setBusy(true);setError("");
  try{await transport.request("/ouvidoria/notices/read",{municipalityId,noticeId:item.id});
   setItems(v=>v.map(x=>x.id===item.id?{...x,readAt:new Date().toISOString()}:x));
   if(!item.readAt)setUnread(n=>Math.max(0,n-1));
  }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 return <View style={styles.box}>
  <Text style={styles.head}>Avisos do protocolo · {unread} não lidos</Text>
  <Text style={styles.help}>{total} avisos no histórico deste município.</Text>
  <Text style={styles.help}>Mensagens internas sem detalhes pessoais. Atualize para verificar mudanças.</Text>
  <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void refresh()} style={styles.button}>
   <Text style={styles.buttonText}>Atualizar avisos</Text></Pressable>
  {busy&&<ActivityIndicator color="#075e59"/>}
  {items.length===0?<Text style={styles.help}>Nenhum aviso nesta página.</Text>:items.map(item=><View key={item.id} style={styles.item}>
   <Text style={styles.text}>{protocolEventLabels[item.code]} · protocolo {item.protocolId.slice(0,8)}</Text>
   {!item.readAt&&<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void seen(item)}
     style={styles.button}><Text style={styles.buttonText}>Marcar como lido</Text></Pressable>}
  </View>)}
  {next&&<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void refresh(next)} style={styles.button}>
   <Text style={styles.buttonText}>Carregar anteriores</Text></Pressable>}
  {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
 </View>;
}
const styles=StyleSheet.create({box:{gap:9,paddingVertical:10},head:{fontSize:17,fontWeight:"700",color:"#194239"},
 help:{fontSize:13,color:"#546b61"},text:{fontSize:14,color:"#234238"},item:{padding:10,backgroundColor:"#f1f7f3",gap:8,borderRadius:8},
 button:{backgroundColor:"#e7f1ec",padding:11,borderRadius:8,alignItems:"center"},
 buttonText:{color:"#075e59",fontWeight:"700"},error:{color:"#923628"}});
