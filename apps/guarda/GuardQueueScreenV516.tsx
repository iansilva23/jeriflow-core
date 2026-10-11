/** Tela operacional experimental da Guarda V5.16 — NÃO montada no App.tsx.
 * Original: guarda-semus/index.html (filas e detalhe), ZIP SHA-256:
 * 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * Sem acesso a token, fotos, storage ou rede direta.
 */
import {useState} from "react";
import {ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,View} from "react-native";
import type {GuardQueueFilterV516} from "./guard-read-client-v516.ts";

export type GuardQueueItemV516=Readonly<{protocolId:string;status:string;title?:string;location?:string}>;
export type GuardScreenActionsV516=Readonly<{
 load:(filter:GuardQueueFilterV516)=>Promise<ReadonlyArray<GuardQueueItemV516>>;
 open:(protocolId:string)=>Promise<Record<string,unknown>>;
 accept:(protocolId:string)=>Promise<void>;
}>;
const FILTERS:ReadonlyArray<Readonly<{key:GuardQueueFilterV516;label:string}>>=[
 {key:"NEW",label:"Novas"},{key:"IN_SERVICE",label:"Em atendimento"},
 {key:"FINISHED",label:"Finalizadas"}
];
const ID=/^JF-[0-9]{8}-[0-9]{6}$/;
function detailValue(item:Record<string,unknown>,field:string):string {
 const value=item[field];return typeof value==="string"&&value.trim()?value:"—";
}
export default function GuardQueueScreenV516({actions}:Readonly<{actions:GuardScreenActionsV516}>) {
 const [filter,setFilter]=useState<GuardQueueFilterV516>("NEW");
 const [items,setItems]=useState<ReadonlyArray<GuardQueueItemV516>>([]);
 const [selected,setSelected]=useState<Record<string,unknown>|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 async function perform(action:()=>Promise<void>){
  if(busy)return;
  setBusy(true);setError("");
  try{await action();}catch{setError("Não foi possível concluir. Verifique a conexão e tente novamente.");}
  finally{setBusy(false);}
 }
 const reload=(next:GuardQueueFilterV516)=>perform(async()=>{
  const response=await actions.load(next);
  setItems(response.filter(i=>ID.test(i.protocolId)));
  setFilter(next);setSelected(null);
 });
 const open=(id:string)=>perform(async()=>{
  if(!ID.test(id))throw Error("INVALID_PROTOCOL");
  const value=await actions.open(id);
  if(value.protocolId!==id)throw Error("INVALID_RESPONSE");
  setSelected(value);
 });
 const accept=(id:string)=>perform(async()=>{
  if(!ID.test(id))throw Error("INVALID_PROTOCOL");
  await actions.accept(id);
  setSelected(null);
  setItems(await actions.load(filter));
 });
 return <ScrollView contentContainerStyle={styles.page}>
  <Text style={styles.heading}>Guarda / SEMUS</Text>
  <Text style={styles.subhead}>Denúncias de trânsito</Text>
  <View style={styles.tabs}>{FILTERS.map(f=><Pressable key={f.key} accessibilityRole="button"
   accessibilityState={{selected:filter===f.key,disabled:busy}}
   disabled={busy} onPress={()=>void reload(f.key)}
   style={[styles.tab,filter===f.key&&styles.active]}>
   <Text style={styles.tabText}>{f.label}</Text></Pressable>)}</View>
  {busy&&<ActivityIndicator accessibilityLabel="Carregando denúncias"/>}
  {error!==""&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  {!selected?<View style={styles.group}>
   {items.length===0&&<Text style={styles.muted}>Selecione uma fila para consultar os protocolos.</Text>}
   {items.map(item=><Pressable accessibilityRole="button" disabled={busy} key={item.protocolId}
    style={styles.card} onPress={()=>void open(item.protocolId)}>
    <Text style={styles.strong}>{item.title||"Denúncia de trânsito"}</Text>
    <Text>{item.protocolId}</Text><Text>{item.location||"Local não informado"}</Text>
    <Text>{item.status}</Text>
   </Pressable>)}
  </View>:<View style={styles.card}>
   <Pressable accessibilityRole="button" disabled={busy} onPress={()=>setSelected(null)}>
    <Text style={styles.link}>Voltar à fila</Text></Pressable>
   <Text style={styles.strong}>{detailValue(selected,"title")}</Text>
   <Text>Protocolo: {detailValue(selected,"protocolId")}</Text>
   <Text>Local: {detailValue(selected,"location")}</Text>
   <Text>Descrição: {detailValue(selected,"description")}</Text>
   <Text>Placa: {detailValue(selected,"plate")}</Text>
   <Text>Situação: {detailValue(selected,"status")}</Text>
   {selected.status==="RECEBIDA"&&typeof selected.protocolId==="string"&&
    <Pressable accessibilityRole="button" disabled={busy} style={styles.action}
      onPress={()=>void accept(selected.protocolId as string)}>
      <Text style={styles.actionText}>Atender denúncia</Text>
    </Pressable>}
   <Text style={styles.muted}>A finalização com evidências ficará disponível após homologação específica.</Text>
  </View>}
 </ScrollView>;
}
const styles=StyleSheet.create({
 page:{padding:20,gap:18,backgroundColor:"#f6f5ef",flexGrow:1},
 heading:{fontSize:24,fontWeight:"700",color:"#174c45"},
 subhead:{fontSize:16,color:"#334a43"},
 tabs:{flexDirection:"row",flexWrap:"wrap",gap:8},
 tab:{backgroundColor:"#edf3ef",padding:12,borderRadius:10},
 active:{backgroundColor:"#c8e4d6"},tabText:{color:"#174c45",fontWeight:"600"},
 group:{gap:12},card:{padding:16,borderRadius:12,backgroundColor:"#fff",gap:8},
 strong:{fontSize:17,fontWeight:"700",color:"#183c35"},
 muted:{fontSize:13,color:"#58685f"},error:{color:"#922a21"},
 link:{color:"#075e59",fontWeight:"700"},action:{backgroundColor:"#075e59",padding:14,borderRadius:10},
 actionText:{color:"#fff",fontWeight:"700",textAlign:"center"}
});
