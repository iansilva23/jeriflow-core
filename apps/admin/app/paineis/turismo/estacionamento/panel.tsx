"use client";
import {useEffect,useRef,useState} from "react";
import {cookieTransport,errorMessage} from "../../../../../../packages/auth/client";

type Ticket={id:string;vehiclePlate:string;areaText:string;serviceDay:string;description:string;
 status:"requested"|"in_review"|"answered"|"rejected";revision:number;
 adminResponse:string|null;createdAt:string;updatedAt:string};
type Event={code:string;revision:number;createdAt:string};
const labels:Record<Ticket["status"],string>={requested:"Recebida",in_review:"Em análise",
 answered:"Respondida",rejected:"Não atendida"};
export default function ParkingPanel({municipalityId,municipalityName}:{municipalityId:string;municipalityName:string}){
 const [transport]=useState(cookieTransport),lock=useRef(false);
 const [items,setItems]=useState<Ticket[]>([]),[next,setNext]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[note,setNote]=useState("");
 const [selected,setSelected]=useState<{item:Ticket;operation:"answer"|"reject"}|null>(null);
 const [response,setResponse]=useState("");
 const [history,setHistory]=useState<{id:string;items:Event[]}|null>(null);
 async function load(after?:string){
  const data=await transport.request("/parking/requests/query",{municipalityId,scope:"queue",...(after?{after}:{})});
  if(!Array.isArray(data.items)||data.items.length>20||data.items.some((x:Ticket)=>
    !x||typeof x.id!=="string"||typeof x.vehiclePlate!=="string"||!Object.hasOwn(labels,x.status)))
    throw Error("INVALID_RESPONSE");
  setItems(old=>after?[...new Map([...old,...data.items as Ticket[]].map(v=>[v.id,v])).values()]:data.items as Ticket[]);
  setNext(typeof data.next==="string"?data.next:null);
 }
 async function run(action:()=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(true);setError("");setNote("");
  try{await action()}catch(e){setError(errorMessage(e))}finally{setBusy(false);lock.current=false}
 }
 useEffect(()=>{let active=true;setItems([]);setHistory(null);
  void transport.request("/parking/requests/query",{municipalityId,scope:"queue"})
   .then(v=>{if(active&&Array.isArray(v.items)){setItems(v.items as Ticket[]);setNext(typeof v.next==="string"?v.next:null)}})
   .catch(e=>{if(active)setError(errorMessage(e))});
  return()=>{active=false};
 },[municipalityId,transport]);
 async function change(item:Ticket,operation:"triage"|"answer"|"reject",message?:string){
  await run(async()=>{
   const v=await transport.request("/parking/requests/mutate",{municipalityId,
    operation,requestId:item.id,revision:item.revision,...(message?{message}:{})});
   if(typeof v.requestId!=="string"||v.authorizationIssued!==false||v.paymentRegistered!==false)
    throw Error("INVALID_RESPONSE");
   setSelected(null);setResponse("");setHistory(null);await load();
   setNote("Atualização confirmada e auditada. Nenhum comprovante ou cobrança foi emitido.");
  });
 }
 return <section className="ouvidoria">
  <div className="ouvidoria-header"><div><h2>{municipalityName}</h2>
   <p>Atendimento de solicitações de estacionamento, sem integração à TTS oficial.</p></div>
   <button className="secondary" type="button" disabled={busy} onClick={()=>void run(()=>load())}>Atualizar fila</button></div>
  <p>Os registros desta fila não são reservas, pagamentos de diárias nem autorização para estacionar.</p>
  {items.length===0&&!busy&&<p>Nenhuma solicitação nesta página.</p>}
  <div className="ouvidoria-list">{items.map(item=><article className="ouvidoria-item" key={item.id}>
   <div className="ouvidoria-item-head"><span>{item.serviceDay}</span><strong>{labels[item.status]}</strong></div>
   <h3>Placa {item.vehiclePlate}</h3>
   <p>Área indicada: {item.areaText}</p>
   <p>{item.description}</p>
   <p className="ouvidoria-small">Registro {item.id.slice(0,8)} · revisão {item.revision}</p>
   {item.adminResponse&&<p><strong>Resposta registrada:</strong> {item.adminResponse}</p>}
   <button className="secondary" type="button" disabled={busy} onClick={()=>void run(async()=>{
    const v=await transport.request("/parking/requests/history",{municipalityId,requestId:item.id});
    if(!Array.isArray(v.items))throw Error("INVALID_RESPONSE");
    setHistory({id:item.id,items:v.items as Event[]});
   })}>Consultar histórico</button>
   {history?.id===item.id&&<ol className="ouvidoria-history">{history.items.map(ev=><li key={ev.revision}>
    {ev.code} · revisão {ev.revision} · {new Date(ev.createdAt).toLocaleString("pt-BR")}
   </li>)}</ol>}
   <div className="ouvidoria-actions">
    {item.status==="requested"&&<button type="button" disabled={busy}
     onClick={()=>void change(item,"triage")}>Assumir análise</button>}
    {item.status==="in_review"&&<>
     <button type="button" disabled={busy} onClick={()=>{setSelected({item,operation:"answer"});setResponse("");}}>Responder</button>
     <button className="secondary" type="button" disabled={busy} onClick={()=>{setSelected({item,operation:"reject"});setResponse("");}}>Não atender</button>
    </>}
   </div>
   {selected?.item.id===item.id&&<form className="ouvidoria-confirm" onSubmit={ev=>{
     ev.preventDefault();void change(item,selected.operation,response.trim());
    }}>
    <label>{selected.operation==="answer"?"Resposta ao solicitante":"Motivo do não atendimento"}
     <textarea rows={4} minLength={15} maxLength={1000} value={response} disabled={busy}
      onChange={ev=>setResponse(ev.target.value)} required/>
    </label>
    <button disabled={busy||response.trim().length<15} type="submit">Registrar decisão</button>
    <button type="button" className="secondary" disabled={busy} onClick={()=>setSelected(null)}>Cancelar</button>
   </form>}
  </article>)}</div>
  {next&&<button type="button" className="secondary" disabled={busy} onClick={()=>void run(()=>load(next))}>Carregar mais</button>}
  {error&&<p role="alert" className="error">{error}</p>}
  {note&&<p role="status" className="notice">{note}</p>}
 </section>;
}
