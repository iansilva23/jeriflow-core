"use client";
import {useMemo,useState} from "react";
import {reconcileParkingSandbox,type SandboxEvent,type SandboxEventKind} from "../../../../../../../../packages/contracts/src/parking-finance-sandbox";
type Scenario="none"|"matched"|"duplicate"|"mismatch"|"wrong_tenant"|"reverse"|"chargeback"|"reverse_first";
const mid="00000000-0000-4000-8000-000000000010";
const other="00000000-0000-4000-8000-000000000011";
const orderId="00000000-0000-4000-8000-000000000020";
function event(n:number,kind:SandboxEventKind="confirmed",amountCents=8000,
 municipalityId=mid):SandboxEvent{
 return {id:`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,
 municipalityId,orderId,providerReference:"TEST_"+n,kind,amountCents,currency:"BRL"};
}
const scenarios:{value:Scenario;label:string;hint:string}[]=[
 {value:"none",label:"Sem confirmação",hint:"Nenhum evento de laboratório"},
 {value:"matched",label:"Confirmação fictícia",hint:"Uma correspondência de R$ 80,00"},
 {value:"duplicate",label:"Evento repetido",hint:"Mesma identificação entregue duas vezes"},
 {value:"mismatch",label:"Valor divergente",hint:"Amostra com R$ 40,00, esperado R$ 80,00"},
 {value:"wrong_tenant",label:"Outro município",hint:"Amostra pertencente a outro município"},
 {value:"reverse",label:"Estorno fictício",hint:"Confirmação seguida de reversão de teste"},
 {value:"chargeback",label:"Chargeback fictício",hint:"Confirmação seguida de contestação de teste"},
 {value:"reverse_first",label:"Estorno fora de ordem",hint:"Tentativa de reverter sem confirmação"},
];
const titles={
 awaiting_sample:"Nenhum evento de teste",
 simulated_match:"Correspondência SOMENTE simulada",
 simulated_reversal:"Reversão SOMENTE simulada",
 review_required:"Revisão necessária — cenário recusado",
};
function samples(s:Scenario):SandboxEvent[]{
 switch(s){
 case "matched":return [event(1)];
 case "duplicate":return [event(1),event(1)];
 case "mismatch":return [event(1,"confirmed",4000)];
 case "wrong_tenant":return [event(1,"confirmed",8000,other)];
 case "reverse":return [event(1),event(2,"refunded")];
 case "chargeback":return [event(1),event(2,"chargeback")];
 case "reverse_first":return [event(1,"refunded"),event(2)];
 default:return [];
 }
}
export default function SandboxPanel({municipalityName}:{municipalityName:string}){
 const [chosen,setChosen]=useState<Scenario>("none");
 const result=useMemo(()=>reconcileParkingSandbox({municipalityId:mid,orderId,
  expectedCents:8000,currency:"BRL",events:samples(chosen)}),[chosen]);
 const selected=scenarios.find(s=>s.value===chosen);
 return <section className="ouvidoria">
  <div className="ouvidoria-header">
   <div><h2>{municipalityName}</h2>
    <p>Exemplos fixos e totalmente fictícios. Nenhuma conexão de pagamentos.</p></div>
  </div>
  <h3>Escolha um cenário de laboratório</h3>
  <div className="ouvidoria-list">{scenarios.map(s=><button key={s.value}
   type="button" className="secondary" aria-pressed={chosen===s.value}
   onClick={()=>setChosen(s.value)}>{s.label} — {s.hint}</button>)}</div>
  <article className="ouvidoria-item" aria-label="Resultado do laboratório">
   <h3>{titles[result.status]}</h3>
   <p>{selected?.hint}</p>
   <p>Código de teste: <code>{result.reason}</code></p>
   <p>Eventos distintos: {result.uniqueEvents}; repetições ignoradas: {result.duplicateEvents}</p>
   <p><strong>Pagamento registrado: NÃO. Cobrança habilitada: NÃO.
     Voucher emitido: NÃO. Prazo quitado: NENHUM.</strong></p>
   <p>Este cálculo serve apenas para ensaiar detecção de inconsistências.
    A aceitação financeira real exigirá validação criptográfica de eventos pelo provedor,
    reconciliação e autorização institucional específica.</p>
  </article>
 </section>;
}
