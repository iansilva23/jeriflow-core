"use client";
import {useRef,useState} from "react";
import {cookieTransport,errorMessage} from "../../../../../../../../packages/auth/client";
type CaseView={caseId:string;orderKey:string;expectedCents:number;currency:"BRL";
 testOnly:true;financialEffectsEnabled:false;paymentRegistered:false;authorizationIssued:false;
 voucherIssued:false;debtCreated:false;paidUntil:null;
 events:{sampleEventId:string;sampleReference:string;sampleKind:string;sampleAmountCents:number;recordedAt:string}[]};
type SampleKind="sample_confirmation"|"sample_refund"|"sample_chargeback";
function safeResponse(v:unknown):v is CaseView{
 const x=v as CaseView|null;
 return !!x&&typeof x.caseId==="string"&&x.testOnly===true&&
  x.financialEffectsEnabled===false&&x.paymentRegistered===false&&
  x.authorizationIssued===false&&x.voucherIssued===false&&
  x.debtCreated===false&&x.paidUntil===null&&Array.isArray(x.events)&&x.events.length<=100;
}
const labels:Record<SampleKind,string>={
 sample_confirmation:"Confirmação artificial",sample_refund:"Estorno artificial",
 sample_chargeback:"Chargeback artificial"};
export default function LabAuditPanel({municipalityId}:{municipalityId:string}){
 const [transport]=useState(cookieTransport),lock=useRef(false);
 const req=useRef<{clientRequestId:string;orderKey:string}|null>(null);
 const eventId=useRef<string|null>(null);
 const [caseId,setCaseId]=useState<string|null>(null),[view,setView]=useState<CaseView|null>(null);
 const [kind,setKind]=useState<SampleKind>("sample_confirmation");
 const [amount,setAmount]=useState<"8000"|"4000">("8000");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 async function run(action:()=>Promise<void>){
  if(lock.current)return;
  lock.current=true;setBusy(true);setError("");setMessage("");
  try{await action()}catch(e){setError(errorMessage(e))}
  finally{setBusy(false);lock.current=false;}
 }
 async function refresh(id:string){
  const response=await transport.request("/parking/lab/query",{municipalityId,caseId:id});
  if(!safeResponse(response))throw new Error("INVALID_RESPONSE");
  setView(response);
 }
 async function create(){
  await run(async()=>{
   const ids=req.current??(req.current={clientRequestId:crypto.randomUUID(),orderKey:crypto.randomUUID()});
   const result=await transport.request("/parking/lab/mutate",{municipalityId,
    operation:"create_case",...ids,expectedCents:8000});
   if(result.testOnly!==true||result.paymentRegistered!==false||
      result.financialEffectsEnabled!==false||typeof result.caseId!=="string")
      throw Error("INVALID_RESPONSE");
   setCaseId(result.caseId);await refresh(result.caseId);req.current=null;
   setMessage("Caso fictício salvo para auditoria. Nenhum pagamento foi criado.");
  });
 }
 async function append(){
  if(!caseId)return;
  await run(async()=>{
   const key=eventId.current??(eventId.current=crypto.randomUUID());
   const result=await transport.request("/parking/lab/mutate",{
    operation:"append_event",municipalityId,caseId,sampleEventId:key,
    sampleReference:"TEST_"+key.replaceAll("-","").slice(0,16).toUpperCase(),
    sampleKind:kind,sampleAmountCents:Number(amount)});
   if(result.testOnly!==true||result.paymentRegistered!==false||
      result.financialEffectsEnabled!==false||result.caseId!==caseId)
     throw Error("INVALID_RESPONSE");
   await refresh(caseId);eventId.current=null;
   setMessage("Evento artificial registrado em trilha auditável. Sem quitação.");
  });
 }
 return <section className="ouvidoria">
  <h2>Registro auditável — ambiente de testes</h2>
  <p>Esta seção grava apenas amostras artificiais no PostgreSQL de desenvolvimento.
   Não aceita dados de pagamento reais, comprovantes ou identificadores de provedores.</p>
  {!caseId?
   <button type="button" disabled={busy} onClick={()=>void create()}>Criar caso fictício de R$ 80,00</button>:
   <div className="ouvidoria-confirm">
    <h3>Caso fictício aberto</h3>
    <p>Referência interna de teste: {caseId}</p>
    <label>Tipo de evento artificial
     <select aria-label="Evento artificial" value={kind} disabled={busy}
      onChange={e=>{setKind(e.target.value as SampleKind);eventId.current=null;}}>
      {Object.entries(labels).map(([key,value])=><option key={key} value={key}>{value}</option>)}
     </select>
    </label>
    <label>Valor da amostra
     <select aria-label="Valor da amostra" value={amount} disabled={busy}
      onChange={e=>{setAmount(e.target.value as "8000"|"4000");eventId.current=null;}}>
      <option value="8000">R$ 80,00 — coincide com o esperado</option>
      <option value="4000">R$ 40,00 — divergência proposital</option>
     </select>
    </label>
    <button type="button" disabled={busy||((view?.events.length??0)>=100)}
     onClick={()=>void append()}>Registrar evento artificial</button>
    <button type="button" className="secondary" disabled={busy}
     onClick={()=>void run(()=>refresh(caseId))}>Atualizar trilha</button>
    <button type="button" className="secondary" disabled={busy}
     onClick={()=>{setCaseId(null);setView(null);req.current=null;eventId.current=null;}}>
     Começar outro caso fictício</button>
   </div>}
  {view&&<article className="ouvidoria-item">
   <h3>Trilha de auditoria fictícia ({view.events.length} evento(s))</h3>
   <p>Valor de referência de teste: R$ {(view.expectedCents/100).toFixed(2).replace(".",",")}.</p>
   <ol className="ouvidoria-history">{view.events.map(e=><li key={e.sampleEventId}>
    {labels[e.sampleKind as SampleKind]??"Evento de teste"} —
    R$ {(e.sampleAmountCents/100).toFixed(2).replace(".",",")} —
    {new Date(e.recordedAt).toLocaleString("pt-BR")}
   </li>)}</ol>
   <p><strong>Pagamento registrado: NÃO. Voucher: NÃO.
    Cobrança: NÃO. Período quitado: NÃO.</strong></p>
  </article>}
  {error&&<p role="alert" className="error">{error}</p>}
  {message&&<p role="status" className="notice">{message}</p>}
 </section>;
}
