import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Transport } from "../auth/client";
import CitizenNotices from "./CitizenNotices";
import { AuthFailure, errorMessage } from "../auth/client";
import { protocolCategories, protocolMutationResult, protocolStatusLabels, protocolEventLabels,
  readProtocolHistory, readProtocolPage, type ProtocolEvent, type ProtocolCategory,
  type ProtocolRecord } from "../contracts/src/ouvidoria";

export type SelectedEvidence={fileName:string;mediaType:string;sizeBytes:number;dataBase64:string};
type Municipality = { id: string; displayName: string };
type Props = { transport: Transport; municipalities: Municipality[]; pickAttachment?:()=>Promise<SelectedEvidence|null> };
// Este UUID identifica apenas a tentativa de criação para idempotência; NÃO é credencial nem segredo.
// Não há autenticador ou geração de token baseada nele.
function newRequestId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r=Math.floor(Math.random()*16);
    return (c==="x"?r:(r&3)|8).toString(16);
  });
}
export default function CitizenProtocols({ transport, municipalities, pickAttachment }: Props) {
  const [municipalityId,setMunicipalityId]=useState(municipalities[0]?.id??"");
  const [items,setItems]=useState<ProtocolRecord[]>([]),[next,setNext]=useState<string|null>(null);
  const [category,setCategory]=useState<ProtocolCategory>("solicitacao");
  const [title,setTitle]=useState(""),[description,setDescription]=useState("");
  const [message,setMessage]=useState(""),[selected,setSelected]=useState<ProtocolRecord|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [newForm,setNewForm]=useState(false);
  const [history,setHistory]=useState<{id:string;items:ProtocolEvent[]}|null>(null);
  const [attachments,setAttachments]=useState<{id:string;items:{id:string;fileName:string;status:string;sizeBytes:number}[]}|null>(null);
  const pendingCreate=useRef<string|null>(null), lock=useRef(false), revision=useRef(0);
  async function refresh(after?:string) {
    const result=readProtocolPage(await transport.request("/ouvidoria/query",{municipalityId,scope:"meus",...(after?{after}:{})}));
    if (after) setItems(current => [...new Map([...current,...result.items].map(item=>[item.id,item])).values()]);
    else setItems(result.items);
    setNext(result.next);
  }
  useEffect(()=>{
    const seq=++revision.current;
    setItems([]);setNext(null);setSelected(null);setHistory(null);setAttachments(null);setNewForm(false);setError("");setNotice("");
    if(!municipalityId) return;
    // Evita que uma consulta antiga de outro município atualize a lista selecionada.
    void transport.request("/ouvidoria/query",{municipalityId,scope:"meus"})
      .then(readProtocolPage)
      .then(result=>{if(seq===revision.current){setItems(result.items);setNext(result.next);}})
      .catch(e=>{if(seq===revision.current)setError(errorMessage(e));});
    return ()=>{revision.current++;};
  },[transport,municipalityId]);
  async function run(action:()=>Promise<void>) {
    if(lock.current)return;lock.current=true;setBusy(true);setError("");setNotice("");
    try{await action();}
    catch(e){
      const uncertain=e instanceof AuthFailure && e.code==="NETWORK";
      setError(uncertain?"Não foi possível confirmar a operação. Atualize a lista antes de tentar novamente.":errorMessage(e));
    }finally{lock.current=false;setBusy(false);}
  }
  const button=(label:string,action:()=>void,secondary=false,disabled=false)=>
    <Pressable accessibilityRole="button" accessibilityState={{disabled:disabled||busy}}
      disabled={disabled||busy} onPress={action}
      style={[styles.button,secondary&&styles.secondary,(disabled||busy)&&styles.disabled]}>
      <Text style={[styles.buttonText,secondary&&styles.secondaryText]}>{label}</Text>
    </Pressable>;
  const input=(label:string,value:string,change:(text:string)=>void,multiline=false,maxLength=120)=>
    <View style={styles.field}><Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={change} editable={!busy}
        multiline={multiline} maxLength={maxLength} style={[styles.input,multiline&&styles.multiline]}
        textAlignVertical={multiline?"top":"center"}/>
    </View>;
  function submit() {
    void run(async()=>{
      const id=pendingCreate.current??(pendingCreate.current=newRequestId());
      protocolMutationResult(await transport.request("/ouvidoria/mutate",
        {operation:"create",municipalityId,clientRequestId:id,category,title:title.trim(),description:description.trim()}));
      pendingCreate.current=null;setTitle("");setDescription("");setNewForm(false);
      await refresh();setNotice("Protocolo registrado. Confira o acompanhamento abaixo.");
    });
  }
  function contest(protocol:ProtocolRecord) {
    void run(async()=>{
      protocolMutationResult(await transport.request("/ouvidoria/mutate",
        {operation:"contest",municipalityId,protocolId:protocol.id,revision:protocol.revision,message:message.trim()}));
      setSelected(null);setMessage("");setHistory(null);
      await refresh();setNotice("Contestação registrada.");
    });
  }
  function toggleHistory(item:ProtocolRecord){
    if(history?.id===item.id){setHistory(null);return;}
    void run(async()=>{
      const result=readProtocolHistory(await transport.request("/ouvidoria/history",
        {municipalityId,protocolId:item.id}));
      setHistory({id:item.id,items:result.items});
    });
  }
  function showAttachments(item:ProtocolRecord) {
    if(attachments?.id===item.id){setAttachments(null);return;}
    void run(async()=>{
      const data=await transport.request("/ouvidoria/attachments/list",
        {municipalityId,protocolId:item.id});
      if(!Array.isArray(data.items)||data.items.length>5||data.items.some(x=>
        !x||typeof x.id!=="string"||typeof x.fileName!=="string"||
        typeof x.sizeBytes!=="number"||!["quarantined","scanning","rejected","clean"].includes(x.status)))
        throw new AuthFailure("INVALID_RESPONSE");
      setAttachments({id:item.id,items:data.items as {id:string;fileName:string;status:string;sizeBytes:number}[]});
    });
  }
  function sendAttachment(item:ProtocolRecord){
    if(!pickAttachment)return;
    void run(async()=>{
      const epoch=revision.current;
      const file=await pickAttachment();
      if(!file||epoch!==revision.current)return;
      if(file.sizeBytes<32||file.sizeBytes>1048576||
        !["image/jpeg","image/png","application/pdf"].includes(file.mediaType)||
        !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(file.fileName)||
        file.fileName.includes("..")||
        !/^[A-Za-z0-9+/=]+$/.test(file.dataBase64))throw new AuthFailure("INVALID_INPUT");
      const result=await transport.request("/ouvidoria/attachments/upload",{
        municipalityId,protocolId:item.id,clientRequestId:newRequestId(),
        fileName:file.fileName,mediaType:file.mediaType,dataBase64:file.dataBase64
      });
      if(result.status!=="quarantined")throw new AuthFailure("INVALID_RESPONSE");
      const listed=await transport.request("/ouvidoria/attachments/list",
        {municipalityId,protocolId:item.id});
      if(epoch===revision.current&&Array.isArray(listed.items))
        setAttachments({id:item.id,items:listed.items as {id:string;fileName:string;status:string;sizeBytes:number}[]});
      setNotice("Arquivo recebido em quarentena. O conteúdo não está disponível para leitura.");
    });
  }
  return <View style={styles.root}>
    <Text style={styles.title}>Ouvidoria · Protocolos</Text>
    <CitizenNotices transport={transport} municipalityId={municipalityId}/>
    <Text style={styles.helper}>Ambiente de desenvolvimento. Não use dados pessoais reais, denúncias verdadeiras ou fotos.</Text>
    {municipalities.length>1&&<View style={styles.row}>
      {municipalities.map(city=>button(city.displayName,()=>setMunicipalityId(city.id),city.id!==municipalityId))}
    </View>}
    {button(newForm?"Cancelar registro":"Registrar solicitação",()=>{
      setNewForm(v=>!v);setSelected(null);setError("");setNotice("");pendingCreate.current=null;
    },true)}
    {newForm&&<View style={styles.section}>
      <Text style={styles.label}>Tipo de protocolo</Text>
      <View style={styles.row}>{(Object.keys(protocolCategories) as ProtocolCategory[]).map(k=>
        button(protocolCategories[k],()=>setCategory(k),k!==category))}</View>
      {input("Assunto",title,v=>{setTitle(v);pendingCreate.current=null;},false,120)}
      {input("Descrição",description,v=>{setDescription(v);pendingCreate.current=null;},true,4000)}
      {button("Enviar protocolo",submit,false,title.trim().length<5||description.trim().length<20)}
    </View>}
    <View style={styles.header}><Text style={styles.subtitle}>Meus protocolos</Text>
      {button("Atualizar",()=>void run(()=>refresh()),true)}</View>
    {busy&&<ActivityIndicator color="#075e59"/>}
    {items.length===0?<Text style={styles.helper}>Nenhum protocolo nesta página.</Text>:
      items.map(item=><View key={item.id} style={styles.record}>
        <Text style={styles.label}>{protocolCategories[item.category]} · {protocolStatusLabels[item.status]}</Text>
        <Text style={styles.recordTitle}>{item.title}</Text>
        <Text style={styles.helper}>Protocolo: {item.id.slice(0,8)} · Revisão {item.revision}</Text>
        <Text style={styles.body}>{item.description}</Text>
        {item.response&&<Text style={styles.body}>Resposta: {item.response}</Text>}
        {item.contestNote&&<Text style={styles.body}>Contestação: {item.contestNote}</Text>}
                {button(attachments?.id===item.id?"Ocultar anexos":"Ver anexos",()=>showAttachments(item),true)}
        {attachments?.id===item.id&&<View style={styles.timeline}>
          <Text style={styles.label}>Arquivos protegidos</Text>
          {attachments.items.map(a=><Text key={a.id} style={styles.body}>
            {a.fileName} · {Math.ceil(a.sizeBytes/1024)} KB ·
            {a.status==="quarantined"?" Em quarentena":a.status==="rejected"?" Rejeitado":" Verificado"}
          </Text>)}
          <Text style={styles.helper}>Não é possível abrir ou baixar arquivos enquanto a liberação segura não estiver disponível.</Text>
          {pickAttachment&&item.status!=="closed"&&attachments.items.length<5&&
            button("Selecionar documento ou foto",()=>sendAttachment(item),false)}
        </View>}
        {button(history?.id===item.id?"Ocultar histórico":"Ver histórico",()=>toggleHistory(item),true)}
        {history?.id===item.id&&<View style={styles.timeline}>
          <Text style={styles.label}>Histórico do protocolo</Text>
          {history.items.map(ev=><Text key={ev.revision} style={styles.body}>
            {ev.revision}. {protocolEventLabels[ev.code]} · {new Date(ev.createdAt).toLocaleString("pt-BR")}
          </Text>)}
        </View>}
        {item.status==="responded"&&item.contestCount===0&&button(selected?.id===item.id?"Cancelar contestação":"Contestar resposta",
          ()=>{setSelected(selected?.id===item.id?null:item);setMessage("");},true)}
        {selected?.id===item.id&&<>
          {input("Justificativa da contestação",message,setMessage,true,2000)}
          {button("Confirmar contestação",()=>contest(item),false,message.trim().length<15)}
        </>}
      </View>)}
    {next&&button("Carregar mais",()=>void run(()=>refresh(next)),true)}
    {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!!notice&&<Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
  </View>;
}
const styles=StyleSheet.create({
  root:{gap:14,borderTopWidth:1,borderTopColor:"#d8e5de",paddingTop:18},
  title:{fontSize:21,fontWeight:"800",color:"#194239"},subtitle:{fontSize:17,fontWeight:"700",color:"#194239"},
  helper:{fontSize:13,color:"#546b61",lineHeight:20},label:{fontSize:13,fontWeight:"700",color:"#29473e"},
  body:{fontSize:14,lineHeight:21,color:"#304d42"},
  row:{flexDirection:"row",flexWrap:"wrap",gap:8},section:{gap:12,backgroundColor:"#f8faf8",padding:12,borderRadius:10},
  timeline:{gap:7,borderLeftWidth:3,borderLeftColor:"#72a98e",paddingLeft:12,paddingVertical:8},
  header:{gap:8},field:{gap:6},input:{borderWidth:1,borderColor:"#a9c4b8",borderRadius:8,padding:12,
    color:"#15392f",backgroundColor:"#fff",minHeight:48},multiline:{minHeight:100},
  button:{backgroundColor:"#075e59",padding:12,borderRadius:9,alignItems:"center",justifyContent:"center",minHeight:45},
  buttonText:{color:"#fff",fontWeight:"700",textAlign:"center"},secondary:{backgroundColor:"#e7f1ec"},
  secondaryText:{color:"#075e59"},disabled:{opacity:0.5},record:{gap:8,padding:14,backgroundColor:"#f4f8f5",
    borderRadius:12,borderWidth:1,borderColor:"#d9e6de"},recordTitle:{fontSize:16,fontWeight:"700",color:"#193d33"},
  error:{backgroundColor:"#fff0ed",color:"#923628",padding:12,borderRadius:9},
  notice:{backgroundColor:"#eaf5ee",color:"#1e6447",padding:12,borderRadius:9}
});
