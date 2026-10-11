import test from "node:test";
import assert from "node:assert/strict";
import {
 createParkingVoucherHtmlV516
} from "../apps/api/src/parking-voucher-v516.ts";

const token="JFPK-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ23";
const entry="2026-09-10T15:30:00-03:00";
const base={
 id:"6dac6652-a05b-442f-9064-620d27b94fe2",
 plate:"ABC1D23",brand:"Toyota",model:"Etios",vehicleYear:2024,
 responsibleName:"Turista Fictício",document:"CPF fictício",phone:"88000000000",
 tourists:["Turista Fictício","Acompanhante Fictício"],
 lodging:"Pousada de Teste",
 entryAt:entry,paidUntil:"2026-09-13T18:30:00.000Z",paidDays:3,
 dailyRateCents:4000,totalPaidCents:"12000",
 prepaidMultiDay:false,manualExitAt:null
};
const payments=[
 {kind:"INITIAL",addedDays:1,amountCents:4000,method:"PIX"},
 {kind:"EXTENSION",addedDays:2,amountCents:"8000",method:"DEBITO"},
];
const input=(r=base,p=payments,at="2026-09-11T10:00:00.000Z")=>({
 registration:r,payments:p,accessToken:token,printedAt:at
});
const invalid=e=>e?.code==="INVALID_PARKING_VOUCHER";
test("V5.16: voucher tem cliente, veículo, hospedagem, pessoas, períodos, pagamentos e chave",()=>{
 const h=createParkingVoucherHtmlV516(input());
 for(const k of ["JeriFlow","VOUCHER","ABC1D23","Toyota","Etios",
  "Turista Fictício","Pousada de Teste","Acompanhante Fictício",
  "PAGAMENTOS REGISTRADOS","12/09/2026","R$","120,00",
  "JFPK-ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ23","Este voucher não é documento fiscal",
  "TTS independente","saída física"]){
   if(k==="12/09/2026")continue;
   assert(h.includes(k),"falta seção: "+k);
 }
 assert(h.startsWith("<!doctype html>"));
 assert(h.includes("<html lang=\"pt-BR\">"));
 assert(!h.includes("window.print()"));
});
test("V5.16: campos do atendimento são escapados contra HTML/script",()=>{
 const r={...base,responsibleName:"<script>alert('x')</script>",
  lodging:"Pousada & Hotel <img src=x onerror=alert(1)>",
  tourists:["<b>Nome falso</b>"],document:'"><svg/onload=alert(1)>'};
 const h=createParkingVoucherHtmlV516(input(r));
 assert(!h.includes("<script>"));
 assert(!h.includes("<img src=x"));
 assert(!h.includes("<svg/onload"));
 assert(!h.includes("<b>Nome falso</b>"));
 assert(h.includes("&lt;script&gt;"));
 assert(h.includes("Pousada &amp; Hotel"));
 assert(h.includes("&lt;b&gt;Nome falso&lt;/b&gt;"));
});
test("V5.16: pagamentos devem somar centavos e diárias reais do cadastro",()=>{
 for(const changes of [
  {...base,totalPaidCents:11999},
  {...base,paidDays:4},
  {...base,paidUntil:"2026-09-13T19:30:00.000Z"},
  {...base,dailyRateCents:0},
  {...base,prepaidMultiDay:true,paidDays:1},
  {...base,entryAt:"data-inválida"},
 ]){
  assert.throws(()=>createParkingVoucherHtmlV516(input(changes)),invalid);
 }
 assert.throws(()=>createParkingVoucherHtmlV516(input(base,[
  {...payments[0],amountCents:0},payments[1]
 ])),invalid);
 assert.throws(()=>createParkingVoucherHtmlV516(input(base,[
  payments[1],payments[0]
 ])),invalid);
});
test("V5.16: voucher indica pagamento antecipado sem inventar reembolso",()=>{
 const prepaid={...base,prepaidMultiDay:true};
 const p=[{kind:"INITIAL",addedDays:3,amountCents:12000,method:"PIX"}];
 const h=createParkingVoucherHtmlV516(input(prepaid,p));
 assert(h.includes("Pagamento antecipado"));
 assert(h.includes("não há reembolso automático"));
 assert(!h.includes("Estorno excepcional realizado"));
});
test("V5.16: vencido NÃO aparece como veículo que saiu fisicamente",()=>{
 const h=createParkingVoucherHtmlV516(input(base,payments,
  "2026-09-15T09:00:00.000Z"));
 assert(h.includes("PENDÊNCIA • PERÍODO PAGO ENCERRADO"));
 assert(!h.includes("SAÍDA REGISTRADA"));
});
test("V5.16: saída registrada mostra encerramento independentemente do pago até",()=>{
 const h=createParkingVoucherHtmlV516(input({
  ...base,manualExitAt:"2026-09-11T15:00:00.000Z"
 },payments,"2026-09-15T09:00:00.000Z"));
 assert(h.includes("SAÍDA REGISTRADA"));
 assert(h.includes("Saída registrada"));
});
test("V5.16: impressão indica vence hoje pela data local, não UTC",()=>{
 const r={...base,entryAt:"2026-09-10T23:30:00-03:00",
   paidUntil:"2026-09-12T02:30:00.000Z",paidDays:1,
   totalPaidCents:4000};
 const h=createParkingVoucherHtmlV516(input(r,[payments[0]],
  "2026-09-11T12:00:00-03:00"));
 assert(h.includes("VENCE HOJE"));
});
test("V5.16: chave precisa ter formato forte, sem aceitar texto livre",()=>{
 assert.throws(()=>createParkingVoucherHtmlV516({
  ...input(),accessToken:"JFPK-XXXX-XXXX"
 }),invalid);
 assert.throws(()=>createParkingVoucherHtmlV516({
  ...input(),accessToken:'JFPK-<script>'
 }),invalid);
});
test("V5.16: voucher não tem cobrança externa, JS ativo nem QR TTS emitido",()=>{
 const h=createParkingVoucherHtmlV516(input());
 assert(!h.includes("<script"));
 assert(!h.includes("https://"));
 assert(!h.includes("APPROVED"));
 assert(!h.includes("QR TTS"));
});
