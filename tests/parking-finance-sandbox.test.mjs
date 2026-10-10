import test from "node:test";
import assert from "node:assert/strict";
import {reconcileParkingSandbox} from "../packages/contracts/src/parking-finance-sandbox.ts";
const municipalityId="00000000-0000-4000-8000-000000000010";
const otherMunicipalityId="00000000-0000-4000-8000-000000000011";
const orderId="00000000-0000-4000-8000-000000000020";
const otherOrderId="00000000-0000-4000-8000-000000000021";
const event=(n,kind="confirmed",amountCents=8000,extra={})=>({
 id:`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,
 municipalityId,orderId,providerReference:"TEST_"+n,kind,amountCents,currency:"BRL",...extra
});
const sample=(events=[],fields={})=>({municipalityId,orderId,expectedCents:8000,currency:"BRL",events,...fields});
function noFinancialEffects(x){
 assert.equal(x.simulationOnly,true);
 assert.equal(x.financialEffectsEnabled,false);
 assert.equal(x.paymentRegistered,false);
 assert.equal(x.authorizationIssued,false);
 assert.equal(x.voucherIssued,false);
 assert.equal(x.debtCreated,false);
 assert.equal(x.paidUntil,null);
}
test("sem amostra: não registra quitação",()=>{
 const result=reconcileParkingSandbox(sample());noFinancialEffects(result);
 assert.equal(result.status,"awaiting_sample");
 assert.equal(result.reason,"NO_SAMPLE_EVENT");
});
test("confirmação fictícia coincidente não vira pagamento real",()=>{
 const result=reconcileParkingSandbox(sample([event(1)]));noFinancialEffects(result);
 assert.equal(result.status,"simulated_match");
 assert.equal(result.reason,"SANDBOX_ONLY_NOT_SETTLED");
});
test("idempotência: repetição exatamente igual não duplica eventos",()=>{
 const a=event(1),result=reconcileParkingSandbox(sample([a,a,a]));
 noFinancialEffects(result);assert.equal(result.status,"simulated_match");
 assert.equal(result.uniqueEvents,1);assert.equal(result.duplicateEvents,2);
});
test("mesmo id com conteúdo diferente sinaliza replay conflitante",()=>{
 const a=event(1),b=event(1,"confirmed",8000,{providerReference:"TEST_DIF"});
 const r=reconcileParkingSandbox(sample([a,b]));
 noFinancialEffects(r);assert.equal(r.status,"review_required");
 assert.equal(r.reason,"EVENT_REPLAY_CONFLICT");
});
test("mesma referência em eventos distintos é conflito",()=>{
 const r=reconcileParkingSandbox(sample([event(1),event(2,"refunded",8000,{providerReference:"TEST_1"})]));
 noFinancialEffects(r);assert.equal(r.status,"review_required");assert.equal(r.reason,"REFERENCE_REUSED");
});
for(const [label,events,reason] of [
 ["parcial",[event(1,"confirmed",4000)],"AMOUNT_MISMATCH_OR_PARTIAL"],
 ["a maior",[event(1,"confirmed",9000)],"AMOUNT_MISMATCH_OR_PARTIAL"],
 ["outra prefeitura",[event(1,"confirmed",8000,{municipalityId:otherMunicipalityId})],"FOREIGN_TENANT_OR_ORDER"],
 ["outro pedido",[event(1,"confirmed",8000,{orderId:otherOrderId})],"FOREIGN_TENANT_OR_ORDER"],
 ["estorno anterior",[event(1,"refunded")],"REVERSAL_WITHOUT_MATCHED_CONFIRMATION"],
 ["chargeback anterior",[event(1,"chargeback")],"REVERSAL_WITHOUT_MATCHED_CONFIRMATION"],
 ["dupla confirmação",[event(1),event(2)],"DUPLICATE_OR_LATE_CONFIRMATION"],
 ["confirmação tardia após estorno",[event(1),event(2,"refunded"),event(3)],"DUPLICATE_OR_LATE_CONFIRMATION"],
 ["segundo estorno",[event(1),event(2,"refunded"),event(3,"refunded")],"REVERSAL_WITHOUT_MATCHED_CONFIRMATION"],
 ["estorno e chargeback",[event(1),event(2,"refunded"),event(3,"chargeback")],"REVERSAL_WITHOUT_MATCHED_CONFIRMATION"],
 ])test(label+": sempre sinalizar revisão sem efeitos financeiros",()=>{
 const r=reconcileParkingSandbox(sample(events));noFinancialEffects(r);
 assert.equal(r.status,"review_required");assert.equal(r.reason,reason);
});
for(const kind of ["refunded","chargeback"])test("reversão fictícia "+kind+" não movimenta dinheiro",()=>{
 const r=reconcileParkingSandbox(sample([event(1),event(2,kind)]));
 noFinancialEffects(r);assert.equal(r.status,"simulated_reversal");
});
test("eventos em ordem inversa não são ordenados artificialmente",()=>{
 const r=reconcileParkingSandbox(sample([event(2,"refunded"),event(1)]));
 noFinancialEffects(r);assert.equal(r.status,"review_required");
});
test("moeda BRL, números inteiros e esquema fechado são obrigatórios",()=>{
 for(const x of [
  sample([],{expectedCents:0}),sample([],{expectedCents:-1}),
  sample([],{expectedCents:2.5}),sample([],{expectedCents:90000001}),
  sample([],{currency:"USD"}),sample([],{municipalityId:"invalid"}),
  sample([],{amount:40}),sample([event(1,"confirmed",8000,{paid:true})]),
  sample([event(1,"completed")]),sample([event(1,"confirmed",0)]),
  sample([event(1,"confirmed",8000,{providerReference:"x"})]),
  sample(Array.from({length:101},(_,i)=>event(i+1))),
  null,{},[],false
 ]) assert.throws(()=>reconcileParkingSandbox(x),/INVALID_SANDBOX_INPUT/);
});
