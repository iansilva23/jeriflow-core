"use client";
import {useEffect,useState} from "react";
import {cookieTransport,errorMessage} from "../../../../../../packages/auth/client";
import {protocolEventLabels,type ProtocolEventCode} from "../../../../../../packages/contracts/src/ouvidoria";
type N={id:string;protocolId:string;code:ProtocolEventCode;createdAt:string;readAt:string|null};
export default function AdminNotices({municipalityId}:{municipalityId:string}){
 const [transport]=useState(cookieTransport);
 const [items,setItems]=useState<N[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [unread,setUnread]=useState(0),[total,setTotal]=useState(0),[next,setNext]=useState<string|null>(null);
 async function load(after?:string){
  setBusy(true);setError("");
  try{
   const result=await transport.request("/ouvidoria/notices/query",{municipalityId,...(after?{after}:{})});
   if(!Array.isArray(result.items)||result.items.length>20)throw Error("INVALID_RESPONSE");
   setItems(old=>after?[...old,...result.items as N[]]:result.items as N[]);
   setNext(typeof result.next==='string'?result.next:null);setUnread(Number(result.unreadCount));setTotal(Number(result.totalCount));
  }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 useEffect(()=>{let ok=true;setItems([]);void transport.request("/ouvidoria/notices/query",{municipalityId})
 .then(v=>{if(ok&&Array.isArray(v.items)){setItems(v.items as N[]);setNext(typeof v.next==='string'?v.next:null);setUnread(Number(v.unreadCount??0));setTotal(Number(v.totalCount??0))}})
 .catch(e=>{if(ok)setError(errorMessage(e))});return()=>{ok=false}},[municipalityId]);
 async function read(item:N){
  setBusy(true);try{
   await transport.request("/ouvidoria/notices/read",{municipalityId,noticeId:item.id});
   setItems(list=>list.map(n=>n.id===item.id?{...n,readAt:new Date().toISOString()}:n));
   if(!item.readAt)setUnread(n=>Math.max(0,n-1));
  }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 return <section className="ouvidoria-confirm" aria-label="Avisos internos da Ouvidoria">
  <h3>Avisos internos · {unread} não lidos</h3>
  <p>{total} avisos registrados para seu perfil neste município.</p>
  <p>Novas demandas e contestações. Nenhum conteúdo pessoal é incluído no aviso.</p>
  <button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>Atualizar avisos</button>
  {items.length===0&&<p>Nenhum aviso nesta página.</p>}
  {items.map(n=><article key={n.id}><strong>{protocolEventLabels[n.code]}</strong>
   <p>Protocolo {n.protocolId.slice(0,8)} · {new Date(n.createdAt).toLocaleString("pt-BR")}</p>
   {!n.readAt&&<button type="button" className="secondary" disabled={busy} onClick={()=>void read(n)}>Marcar aviso como lido</button>}
  </article>)}
  {next&&<button type="button" className="secondary" disabled={busy} onClick={()=>void load(next)}>Carregar avisos anteriores</button>}
  {!!error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
