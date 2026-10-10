"use client";
import {useEffect,useState} from "react";
import {cookieTransport,errorMessage} from "../../../../../../packages/auth/client";
import {protocolEventLabels,type ProtocolEventCode} from "../../../../../../packages/contracts/src/ouvidoria";
type N={id:string;protocolId:string;code:ProtocolEventCode;createdAt:string;readAt:string|null};
export default function AdminNotices({municipalityId}:{municipalityId:string}){
 const [transport]=useState(cookieTransport);
 const [items,setItems]=useState<N[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function load(){
  setBusy(true);setError("");
  try{
   const result=await transport.request("/ouvidoria/notices/query",{municipalityId});
   if(!Array.isArray(result.items)||result.items.length>20)throw Error("INVALID_RESPONSE");
   setItems(result.items as N[]);
  }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 useEffect(()=>{let ok=true;setItems([]);void transport.request("/ouvidoria/notices/query",{municipalityId})
 .then(v=>{if(ok&&Array.isArray(v.items))setItems(v.items as N[])})
 .catch(e=>{if(ok)setError(errorMessage(e))});return()=>{ok=false}},[municipalityId]);
 async function read(item:N){
  setBusy(true);try{
   await transport.request("/ouvidoria/notices/read",{municipalityId,noticeId:item.id});
   setItems(list=>list.map(n=>n.id===item.id?{...n,readAt:new Date().toISOString()}:n));
  }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 return <section className="ouvidoria-confirm" aria-label="Avisos internos da Ouvidoria">
  <h3>Avisos internos</h3>
  <p>Novas demandas e contestações. Nenhum conteúdo pessoal é incluído no aviso.</p>
  <button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>Atualizar avisos</button>
  {items.length===0&&<p>Nenhum aviso nesta página.</p>}
  {items.map(n=><article key={n.id}><strong>{protocolEventLabels[n.code]}</strong>
   <p>Protocolo {n.protocolId.slice(0,8)} · {new Date(n.createdAt).toLocaleString("pt-BR")}</p>
   {!n.readAt&&<button type="button" className="secondary" disabled={busy} onClick={()=>void read(n)}>Marcar aviso como lido</button>}
  </article>)}
  {!!error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
