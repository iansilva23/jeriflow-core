"use client";
import {useEffect,useRef,useState} from "react";
import {cookieTransport,errorMessage} from "../../../../../../packages/auth/client";
type Case={id:string;kind:string;title:string;description:string;locationText:string|null;occurredAt:string|null;status:"open"|"in_review"|"closed";revision:number;createdAt:string};
const kind:Record<string,string>={ocorrencia:"Ocorrência",apoio:"Apoio",orientacao:"Orientação",outro:"Outro"};
export default function OccurrencePanel({municipalityId,name}:{municipalityId:string;name:string}){
 const [transport]=useState(cookieTransport);
 const [items,setItems]=useState<Case[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [history,setHistory]=useState<{id:string;items:{code:string;revision:number;createdAt:string}[]}|null>(null);
 const lock=useRef(false);
 async function load(){
  const res=await transport.request("/guarda/query",{municipalityId});
  if(!Array.isArray(res.items)||res.items.length>20||
    res.items.some((x:Case)=>!x||typeof x.title!=="string"||!["open","in_review","closed"].includes(x.status)))
    throw Error("INVALID_RESPONSE");
  setItems(res.items as Case[]);
 }
 async function run(fn:()=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(true);setError("");setNotice("");
  try{await fn()}catch(e){setError(errorMessage(e))}finally{setBusy(false);lock.current=false}
 }
 useEffect(()=>{let ok=true;setItems([]);void transport.request("/guarda/query",{municipalityId})
  .then(v=>{if(ok&&Array.isArray(v.items))setItems(v.items as Case[])})
  .catch(e=>{if(ok)setError(errorMessage(e))});return()=>{ok=false}},[municipalityId]);
 async function action(item:Case,operation:"review"|"close"){
  await run(async()=>{
   const data=await transport.request("/guarda/mutate",{operation,municipalityId,occurrenceId:item.id,revision:item.revision});
   if(typeof data.occurrenceId!=="string")throw Error("INVALID_RESPONSE");
   await load();setNotice("Registro atualizado e auditado no servidor.");
  });
 }
 return <section className="ouvidoria">
  <div className="ouvidoria-header"><h2>{name}</h2><button type="button" className="secondary" disabled={busy}
    onClick={()=>void run(load)}>Atualizar ocorrências</button></div>
  {items.length===0&&<p>Nenhuma ocorrência nesta página.</p>}
  <div className="ouvidoria-list">{items.map(c=><article key={c.id} className="ouvidoria-item">
   <div className="ouvidoria-item-head"><span>{kind[c.kind]??c.kind}</span><strong>{c.status==="open"?"Recebido":c.status==="in_review"?"Em análise":"Encerrado"}</strong></div>
   <h3>{c.title}</h3><p>{c.description}</p>
   <p className="ouvidoria-small">Local: {c.locationText??"Não informado"} · Data/hora: {new Date(c.occurredAt??c.createdAt).toLocaleString("pt-BR")}</p>
   <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{
     const result=await transport.request("/guarda/history",{municipalityId,occurrenceId:c.id});
     if(!Array.isArray(result.items))throw Error("INVALID_RESPONSE");
     setHistory({id:c.id,items:result.items as {code:string;revision:number;createdAt:string}[]});
   })}>Ver histórico de atendimento</button>
   {history?.id===c.id&&<ol className="ouvidoria-history">{history.items.map(ev=><li key={ev.revision}>
     {ev.code} · revisão {ev.revision} · {new Date(ev.createdAt).toLocaleString("pt-BR")}
   </li>)}</ol>}
   <p className="ouvidoria-small">Registro {c.id.slice(0,8)} · revisão {c.revision}</p>
   {c.status==="open"&&<button type="button" disabled={busy} onClick={()=>void action(c,"review")}>Iniciar análise</button>}
   {c.status==="in_review"&&<button type="button" disabled={busy} onClick={()=>void action(c,"close")}>Encerrar atendimento</button>}
  </article>)}</div>
  {!!error&&<p role="alert" className="error">{error}</p>}
  {!!notice&&<p role="status" className="notice">{notice}</p>}
 </section>;
}
