"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {cookieTransport,errorMessage} from "../../../../../../../packages/auth/client";

type Entry={id:string;vehiclePlate:string;vehicleBrand:string;vehicleModel:string;
 areaText:string;lodgingName:string|null;entryAt:string;departureAt:string|null;
 status:"present"|"departed";revision:number;plannedDays:number;plannedUntil:string;
 planningStatus:"within_window"|"needs_review"|"departed"};
type Event={code:"entered"|"departed"|"extended";revision:number;createdAt:string};
const initial={vehiclePlate:"",vehicleBrand:"",vehicleModel:"",areaText:"",lodgingName:""};
export default function EntriesPanel({municipalityId,municipalityName}:{municipalityId:string;municipalityName:string}){
 const [transport]=useState(cookieTransport),lock=useRef(false),pending=useRef<string|null>(null);
 const [form,setForm]=useState(initial),[items,setItems]=useState<Entry[]>([]);
 const [next,setNext]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[note,setNote]=useState("");
 const [history,setHistory]=useState<{id:string;items:Event[]}|null>(null);
 const [departure,setDeparture]=useState<Entry|null>(null);
 const [extending,setExtending]=useState<Entry|null>(null);
 const [extraDays,setExtraDays]=useState("1"),extensionRequest=useRef<string|null>(null);
 const [mode,setMode]=useState<"all"|"present"|"needs_review"|"departed">("all");
 const plate=form.vehiclePlate.trim().toUpperCase();
 const valid=/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)&&
  form.vehicleBrand.trim().length>=2&&form.vehicleModel.trim().length>=2&&
  form.areaText.trim().length>=5&&(!form.lodgingName||form.lodgingName.trim().length>=3);
 function setField(k:keyof typeof initial,v:string){
  setForm(old=>({...old,[k]:v}));pending.current=null;
 }
 async function load(after?:string){
  const res=await transport.request("/parking/entries/query",{municipalityId,mode,...(after?{after}:{})});
  if(!Array.isArray(res.items)||res.items.length>20||res.items.some((x:Entry)=>
   !x||typeof x.id!=="string"||typeof x.vehiclePlate!=="string"||
   !["present","departed"].includes(x.status)||
   !["within_window","needs_review","departed"].includes(x.planningStatus)||
   !Number.isSafeInteger(x.plannedDays)||x.plannedDays<1||x.plannedDays>90||
   typeof x.plannedUntil!=="string"))throw Error("INVALID_RESPONSE");
  setItems(old=>after?[...new Map([...old,...res.items as Entry[]].map(x=>[x.id,x])).values()]:res.items as Entry[]);
  setNext(typeof res.next==="string"?res.next:null);
 }
 async function run(action:()=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(true);setError("");setNote("");
  try{await action()}catch(e){setError(errorMessage(e));}
  finally{setBusy(false);lock.current=false;}
 }
 useEffect(()=>{let mounted=true;setItems([]);setHistory(null);setDeparture(null);setExtending(null);extensionRequest.current=null;
  void transport.request("/parking/entries/query",{municipalityId,mode})
   .then(v=>{if(mounted&&Array.isArray(v.items)){setItems(v.items as Entry[]);setNext(typeof v.next==="string"?v.next:null);}})
   .catch(e=>{if(mounted)setError(errorMessage(e));});
  return()=>{mounted=false};
 },[transport,municipalityId,mode]);
 async function enter(ev:FormEvent){
  ev.preventDefault();if(!valid)return;
  await run(async()=>{
   const clientRequestId=pending.current??(pending.current=crypto.randomUUID());
   const result=await transport.request("/parking/entries/mutate",{municipalityId,operation:"enter",
    clientRequestId,vehiclePlate:plate,vehicleBrand:form.vehicleBrand.trim(),
    vehicleModel:form.vehicleModel.trim(),areaText:form.areaText.trim(),
    ...(form.lodgingName.trim()?{lodgingName:form.lodgingName.trim()}:{})});
   if(result.status!=="present"||result.authorizationIssued!==false||
    result.paymentRegistered!==false||result.voucherIssued!==false)throw Error("INVALID_RESPONSE");
   setForm(initial);pending.current=null;await load();
   setNote("Entrada simulada registrada no servidor, sem cobrança ou autorização.");
  });
 }
 async function extend(item:Entry){
  const n=Number(extraDays);
  if(!Number.isSafeInteger(n)||n<1||n>30||item.plannedDays+n>90)return;
  await run(async()=>{
   const clientRequestId=extensionRequest.current??(extensionRequest.current=crypto.randomUUID());
   const result=await transport.request("/parking/entries/extend",{
    municipalityId,entryId:item.id,revision:item.revision,clientRequestId,extraDays:n});
   if(result.status!=="present"||result.authorizationIssued!==false||
      result.paymentRegistered!==false||result.plannedDays!==item.plannedDays+n)
     throw Error("INVALID_RESPONSE");
   extensionRequest.current=null;setExtending(null);setHistory(null);await load();
   setNote("Previsão de permanência ampliada, sem registrar pagamento ou diária oficial.");
  });
 }
 async function depart(item:Entry){
  await run(async()=>{
   const result=await transport.request("/parking/entries/mutate",{municipalityId,
    operation:"depart",entryId:item.id,revision:item.revision});
   if(result.status!=="departed"||!result.departureAt||
    result.authorizationIssued!==false||result.paymentRegistered!==false||
    result.voucherIssued!==false)throw Error("INVALID_RESPONSE");
   setDeparture(null);setExtending(null);setHistory(null);await load();
   setNote("Saída simulada registrada; nenhuma cobrança ou diária foi gerada.");
  });
 }
 return <section className="ouvidoria">
  <div className="ouvidoria-header"><div><h2>{municipalityName}</h2>
   <p>Entradas fictícias, janelas planejadas de 24 horas e histórico. Previsão NÃO significa diária paga.</p></div>
   <button type="button" className="secondary" disabled={busy} onClick={()=>void run(()=>load())}>Atualizar</button></div>
  <form onSubmit={enter} className="ouvidoria-confirm">
   <h3>Nova entrada fictícia</h3>
   <p>Nunca informe placa real ou dados pessoais durante a homologação.</p>
   <label>Placa fictícia
    <input aria-label="Placa fictícia" maxLength={7} value={form.vehiclePlate}
     onChange={e=>setField("vehiclePlate",e.target.value.toUpperCase())} placeholder="ABC1D23" required/></label>
   <label>Marca
    <input aria-label="Marca" maxLength={60} value={form.vehicleBrand}
     onChange={e=>setField("vehicleBrand",e.target.value)} placeholder="Marca de teste" required/></label>
   <label>Modelo
    <input aria-label="Modelo" maxLength={60} value={form.vehicleModel}
     onChange={e=>setField("vehicleModel",e.target.value)} placeholder="Modelo de teste" required/></label>
   <label>Área de referência
    <input aria-label="Área" maxLength={120} value={form.areaText}
     onChange={e=>setField("areaText",e.target.value)} placeholder="Área fictícia" required/></label>
   <label>Hospedagem (opcional, fictícia)
    <input aria-label="Hospedagem" maxLength={120} value={form.lodgingName}
     onChange={e=>setField("lodgingName",e.target.value)} placeholder="Hospedagem fictícia"/></label>
   <button disabled={busy||!valid} type="submit">Registrar entrada simulada</button>
  </form>
  <label>Filtrar veículos por previsão
   <select aria-label="Filtro de planejamento" value={mode}
    onChange={e=>setMode(e.target.value as typeof mode)}>
    <option value="all">Todos os registros</option>
    <option value="present">Sem saída registrada</option>
    <option value="needs_review">Previsão ultrapassada — revisar</option>
    <option value="departed">Com saída registrada</option>
   </select>
  </label>
  <p>Uma janela planejada corresponde a 24 horas decorridas desde a entrada fictícia. Se o prazo
   previsto for ultrapassado, o registro é sinalizado apenas para revisão operacional.
   Não existe débito, multa, pagamento ou autorização presumidos.</p>
  <h3>Registros de entrada</h3>
  {items.length===0&&!busy&&<p>Nenhum veículo fictício nesta página.</p>}
  <div className="ouvidoria-list">{items.map(item=><article key={item.id} className="ouvidoria-item">
   <div className="ouvidoria-item-head"><span>{item.vehiclePlate}</span>
    <strong>{item.planningStatus==="needs_review"?"Revisar previsão":
     item.status==="present"?"Dentro da janela planejada":"Saída registrada"}</strong></div>
   <h3>{item.vehicleBrand} · {item.vehicleModel}</h3>
   <p>Área: {item.areaText}{item.lodgingName?` · Hospedagem: ${item.lodgingName}`:""}</p>
   <p className="ouvidoria-small">Entrada: {new Date(item.entryAt).toLocaleString("pt-BR")}
    {item.departureAt?` · Saída: ${new Date(item.departureAt).toLocaleString("pt-BR")}`:""}
    { ` · Revisão ${item.revision}` }</p>
   <p className="ouvidoria-small">{item.plannedDays} período(s) planejado(s) de 24h ·
    Previsão até: {new Date(item.plannedUntil).toLocaleString("pt-BR")} · não representa pagamento.</p>
   <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{
    const response=await transport.request("/parking/entries/history",{municipalityId,entryId:item.id});
    if(!Array.isArray(response.items)||response.items.length>100)throw Error("INVALID_RESPONSE");
    setHistory({id:item.id,items:response.items as Event[]});
   })}>Histórico</button>
   {history?.id===item.id&&<ol className="ouvidoria-history">{history.items.map(ev=>
    <li key={ev.revision}>{ev.code==="entered"?"Entrada":ev.code==="departed"?"Saída":"Previsão ampliada"} · revisão {ev.revision} ·
     {new Date(ev.createdAt).toLocaleString("pt-BR")}</li>)}</ol>}
   {item.status==="present"&&<>
    {extending?.id!==item.id?
      <button type="button" className="secondary" disabled={busy||item.plannedDays>=90}
       onClick={()=>{setExtending(item);setExtraDays("1");extensionRequest.current=null;}}>
       Ampliar período planejado</button>:
      <div className="ouvidoria-confirm">
       <p>Ampliar apenas a previsão do veículo {item.vehiclePlate}. Não será registrada cobrança.</p>
       <label>Períodos adicionais de 24h
        <select aria-label="Períodos adicionais" value={extraDays} disabled={busy}
         onChange={e=>{setExtraDays(e.target.value);extensionRequest.current=null;}}>
         {[1,2,3,5,7,10,15,30].filter(n=>item.plannedDays+n<=90).map(n=>
          <option key={n} value={n}>{n} período(s)</option>)}
        </select>
       </label>
       <button type="button" disabled={busy||item.plannedDays+Number(extraDays)>90}
        onClick={()=>void extend(item)}>Confirmar ampliação</button>
       <button className="secondary" type="button" disabled={busy}
        onClick={()=>{setExtending(null);extensionRequest.current=null;}}>Cancelar</button>
      </div>}

    {departure?.id!==item.id?
     <button type="button" disabled={busy} onClick={()=>setDeparture(item)}>Registrar saída simulada</button>:
     <div className="ouvidoria-confirm"><p>Confirmar saída fictícia de {item.vehiclePlate}?
      Esta operação será registrada no histórico.</p>
      <button type="button" disabled={busy} onClick={()=>void depart(item)}>Confirmar saída</button>
      <button type="button" disabled={busy} className="secondary" onClick={()=>setDeparture(null)}>Cancelar</button>
     </div>}
   </>}
  </article>)}</div>
  {next&&<button type="button" className="secondary" disabled={busy}
   onClick={()=>void run(()=>load(next))}>Carregar mais registros</button>}
  {error&&<p role="alert" className="error">{error}</p>}
  {note&&<p role="status" className="notice">{note}</p>}
 </section>;
}
