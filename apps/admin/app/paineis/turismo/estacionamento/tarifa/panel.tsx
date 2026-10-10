"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {cookieTransport,errorMessage} from "../../../../../../../packages/auth/client";
type Draft={approvalState:"draft";dailyRateCents:number;currency:"BRL";
 revision:number;rationale:string;updatedAt:string};
type Simulation={entryId:string;plannedDays:number;plannedUntil:string;
 hypotheticalTotalCents:number|null};
type TariffResponse={draft:Draft|null;simulation:Simulation|null;simulationOnly:true;
 payable:false;paymentRegistered:false;authorizationIssued:false;voucherIssued:false;debtCreated:false};
type Entry={id:string;vehiclePlate:string;plannedDays:number};
type Event={revision:number;dailyRateCents:number;createdAt:string};
function formatMoney(cents:number):string{
 return (cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
}
function parseCents(input:string):number|null{
 const match=/^([0-9]{1,5})(?:[,.]([0-9]{1,2}))?$/.exec(input.trim());
 if(!match)return null;
 const result=Number(match[1])*100+Number((match[2]??"").padEnd(2,"0"));
 return Number.isSafeInteger(result)&&result>=1&&result<=1000000?result:null;
}
function isResponse(value:TariffResponse):boolean{
 return !!value&&value.simulationOnly===true&&value.payable===false&&
  value.paymentRegistered===false&&value.authorizationIssued===false&&
  value.voucherIssued===false&&value.debtCreated===false&&
  (value.draft===null||(value.draft?.approvalState==="draft"&&
   Number.isSafeInteger(value.draft?.dailyRateCents)));
}
export default function TariffDraftPanel({municipalityId,municipalityName}:{municipalityId:string;municipalityName:string}){
 const [transport]=useState(cookieTransport);
 const lock=useRef(false),pending=useRef<string|null>(null);
 const [rate,setRate]=useState(""),[rationale,setRationale]=useState("");
 const [draft,setDraft]=useState<Draft|null>(null),[entries,setEntries]=useState<Entry[]>([]);
 const [selected,setSelected]=useState(""),[simulation,setSimulation]=useState<Simulation|null>(null);
 const [history,setHistory]=useState<Event[]>([]),[showHistory,setShowHistory]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const cents=parseCents(rate);
 async function refresh(){
  const data=await transport.request("/parking/tariff/query",{municipalityId}) as TariffResponse;
  if(!isResponse(data))throw new Error("INVALID_RESPONSE");
  setDraft(data.draft);
  if(data.draft){setRate((data.draft.dailyRateCents/100).toFixed(2).replace(".",","));
    setRationale(data.draft.rationale);}
 }
 async function run(action:()=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(true);setError("");setNotice("");
  try{await action()}catch(e){setError(errorMessage(e));}
  finally{setBusy(false);lock.current=false;}
 }
 useEffect(()=>{
  let alive=true;setSelected("");setSimulation(null);setHistory([]);
  void Promise.all([
   transport.request("/parking/tariff/query",{municipalityId}),
   transport.request("/parking/entries/query",{municipalityId,mode:"all"})
  ]).then(([data,listing])=>{
   if(!alive)return;
   if(!isResponse(data as TariffResponse)||!Array.isArray(listing.items))
    throw Error("INVALID_RESPONSE");
   const draft=(data as TariffResponse).draft;setDraft(draft);
   if(draft){setRate((draft.dailyRateCents/100).toFixed(2).replace(".",","));
    setRationale(draft.rationale);}
   setEntries((listing.items as Entry[]).filter(e=>typeof e.id==="string"&&
    typeof e.vehiclePlate==="string"&&Number.isSafeInteger(e.plannedDays)));
  }).catch(e=>{if(alive)setError(errorMessage(e));});
  return()=>{alive=false};
 },[transport,municipalityId]);
 async function submit(e:FormEvent){
  e.preventDefault();if(cents===null||rationale.trim().length<15)return;
  await run(async()=>{
   const clientRequestId=pending.current??(pending.current=crypto.randomUUID());
   const result=await transport.request("/parking/tariff/mutate",{municipalityId,
    clientRequestId,revision:draft?.revision??0,dailyRateCents:cents,
    rationale:rationale.trim()});
   if(result.approvalState!=="draft"||result.paymentRegistered!==false||
    result.payable!==false||result.authorizationIssued!==false||result.debtCreated!==false)
    throw Error("INVALID_RESPONSE");
   pending.current=null;setSelected("");setSimulation(null);
   await refresh();setNotice("Proposta fictícia registrada para estudo. NÃO foi ativada como tarifa.");
  });
 }
 async function preview(entryId:string){
  setSelected(entryId);setSimulation(null);if(!entryId)return;
  await run(async()=>{
   const data=await transport.request("/parking/tariff/query",{municipalityId,entryId}) as TariffResponse;
   if(!isResponse(data)||data.simulation?.entryId!==entryId||
    (data.simulation.hypotheticalTotalCents!==null&&
     !Number.isSafeInteger(data.simulation.hypotheticalTotalCents)))
    throw Error("INVALID_RESPONSE");
   setSimulation(data.simulation);
  });
 }
 async function loadHistory(){
  await run(async()=>{
   const data=await transport.request("/parking/tariff/history",{municipalityId});
   if(!Array.isArray(data.items)||data.items.length>200||
      data.items.some((x:Event)=>!Number.isSafeInteger(x.revision)||!Number.isSafeInteger(x.dailyRateCents)))
      throw Error("INVALID_RESPONSE");
   setHistory(data.items as Event[]);setShowHistory(true);
  });
 }
 return <section className="ouvidoria">
  <div className="ouvidoria-header"><div><h2>{municipalityName}</h2>
   <p>Proposta de parâmetro para simulações internas. Sem aprovação, ativação ou cobrança.</p>
  </div><button className="secondary" type="button" disabled={busy} onClick={()=>void run(refresh)}>
   Atualizar rascunho</button></div>
  <form onSubmit={submit} className="ouvidoria-confirm">
   <h3>Proposta fictícia de valor por período de 24 horas</h3>
   <p>Estado fixo: RASCUNHO. Nenhuma aprovação institucional foi registrada.</p>
   <label>Valor simulado (R$)
    <input aria-label="Valor simulado" value={rate} inputMode="decimal" maxLength={10}
     placeholder="Ex.: 40,00 (apenas exemplo)" required
     onChange={e=>{setRate(e.target.value);pending.current=null;}}/></label>
   <label>Motivo do estudo
    <textarea aria-label="Motivo do estudo" rows={3} minLength={15} maxLength={500}
     value={rationale} placeholder="Explique os parâmetros fictícios do estudo" required
     onChange={e=>{setRationale(e.target.value);pending.current=null;}}/></label>
   <button type="submit" disabled={busy||cents===null||rationale.trim().length<15}>
    Salvar rascunho (sem ativar cobrança)</button>
  </form>
  <p>Estado: <strong>{draft?"Rascunho não aprovado (revisão "+draft.revision+")":
     "Nenhuma proposta cadastrada"}</strong></p>
  <label>Simular para entrada fictícia
   <select aria-label="Entrada para simulação" value={selected} disabled={busy}
    onChange={e=>void preview(e.target.value)}>
    <option value="">Selecione um veículo fictício</option>
    {entries.map(e=><option key={e.id} value={e.id}>
     {e.vehiclePlate} · {e.plannedDays} período(s) planejado(s)</option>)}
   </select>
  </label>
  {simulation&&<article className="ouvidoria-item">
   <h3>Estimativa hipotética — NÃO COBRAR</h3>
   <p>{simulation.plannedDays} período(s) planejado(s) de 24h</p>
   <p>Previsão de término: {new Date(simulation.plannedUntil).toLocaleString("pt-BR")}</p>
   <p>{simulation.hypotheticalTotalCents===null?
    "Sem proposta de tarifa para calcular.":
    "Valor teórico, NÃO devido: "+formatMoney(simulation.hypotheticalTotalCents)}</p>
   <p>Esta estimativa não gera dívida, pagamento, recibo nem autorização.</p>
  </article>}
  <button className="secondary" type="button" disabled={busy} onClick={()=>void loadHistory()}>
   Consultar histórico de rascunhos</button>
  {showHistory&&<ol className="ouvidoria-history">{history.map(e=><li key={e.revision}>
   Revisão {e.revision} · {formatMoney(e.dailyRateCents)} (não aprovado) ·
   {new Date(e.createdAt).toLocaleString("pt-BR")}</li>)}</ol>}
  {error&&<p role="alert" className="error">{error}</p>}
  {notice&&<p role="status" className="notice">{notice}</p>}
 </section>;
}
