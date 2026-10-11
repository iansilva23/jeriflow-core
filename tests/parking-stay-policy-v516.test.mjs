import test from "node:test";
import assert from "node:assert/strict";
import {
  parkingPaidUntilV516,parkingInitialCentsV516,
  parkingStateV516,parkingExtendV516,parkingNormalExitAllowedV516,
} from "../apps/api/src/parking-stay-policy-v516.ts";

/**
 * Fonte consultada antes de criar este teste: ZIP original V5.16,
 * SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 * admin-turismo/index.html paidUntilDate(), stayState(), saveReg(),
 * saveExtension(), registerManualExit(), confirmTolerance().
 * Testes sem pagamentos externos, TTS ou ações operacionais reais.
 */
const entered="2026-09-10T15:30:00-03:00";
const paidEnd="2026-09-11T18:30:00.000Z";
const bad=code=>e=>e?.code===code;

test("V5.16: diária é exatamente 24 h desde hora real de entrada",()=>{
  assert.equal(parkingPaidUntilV516(entered,1),paidEnd);
  assert.equal(parkingPaidUntilV516(entered,3),"2026-09-13T18:30:00.000Z");
  assert.equal(parkingPaidUntilV516("2026-12-31T23:10:00-03:00",1),
    "2027-01-02T02:10:00.000Z");
});

test("V5.16: referência de R$40/diária, sem gateway; antecipação exige ciência",()=>{
  assert.equal(parkingInitialCentsV516(1,4000,false),4000);
  assert.equal(parkingInitialCentsV516(6,4000,true),24000);
  assert.throws(()=>parkingInitialCentsV516(6,4000,false),bad("INVALID_PARKING_INPUT"));
  for(const invalid of [0,-1,3651,1.5]){
    assert.throws(()=>parkingInitialCentsV516(invalid,4000,true),bad("INVALID_PARKING_INPUT"));
  }
  assert.throws(()=>parkingInitialCentsV516(2,0,true),bad("INVALID_PARKING_INPUT"));
});

test("V5.16: não encerra ocupação no vencimento; pendência só após hora exata",()=>{
  assert.deepEqual(parkingStateV516({
    entryAt:entered,paidDays:1,now:paidEnd
  }),{state:"DUE_TODAY",paidUntil:paidEnd,overdueDays:0});
  assert.equal(parkingStateV516({entryAt:entered,paidDays:1,
    now:"2026-09-11T18:30:01.000Z"}).state,"OVERDUE");
  assert.equal(parkingStateV516({entryAt:entered,paidDays:1,
    now:"2026-09-12T18:30:00.000Z"}).overdueDays,1);
  assert.equal(parkingStateV516({entryAt:entered,paidDays:1,
    now:"2026-09-12T18:30:01.000Z"}).overdueDays,2);
  assert.equal(parkingStateV516({entryAt:entered,paidDays:1,
    now:"2026-09-09T18:30:00.000Z"}).state,"UPCOMING");
  assert.equal(parkingStateV516({entryAt:entered,paidDays:1,
    exitAt:"2026-09-11T18:20:00.000Z",
    now:"2026-09-12T18:30:00.000Z"}).state,"EXITED");
});

test("V5.16: perto da meia-noite UTC, vencimento usa dia LOCAL de Jericoacoara",()=>{
  const late="2026-09-10T23:30:00-03:00";
  const state=parkingStateV516({
    entryAt:late,paidDays:1,now:"2026-09-11T12:00:00-03:00"
  });
  assert.equal(state.state,"DUE_TODAY");
  assert.equal(state.paidUntil,"2026-09-12T02:30:00.000Z");
});

test("V5.16: extensão acrescenta diárias a partir do limite já pago",()=>{
  assert.deepEqual(parkingExtendV516({
    entryAt:entered,currentPaidDays:1,addDays:3,dailyRateCents:4000
  }),{paidDays:4,addedCents:12000,paidUntil:"2026-09-14T18:30:00.000Z"});
  assert.throws(()=>parkingExtendV516({
    entryAt:entered,currentPaidDays:3650,addDays:1,dailyRateCents:4000
  }),bad("INVALID_PARKING_INPUT"));
});

test("V5.16: saída pendente exige antes extensão ou tolerância justificada",()=>{
  assert.throws(()=>parkingNormalExitAllowedV516({
    entryAt:entered,paidDays:1,exitAt:"2026-09-12T11:00:00.000Z",
    prepaidMultiDay:false
  }),bad("PARKING_EXIT_BLOCKED"));
  assert.doesNotThrow(()=>parkingNormalExitAllowedV516({
    entryAt:entered,paidDays:1,exitAt:"2026-09-11T18:15:00.000Z",
    prepaidMultiDay:false
  }));
});

test("V5.16: saída antes do pago até com várias diárias exige regra coordenada",()=>{
  assert.throws(()=>parkingNormalExitAllowedV516({
    entryAt:entered,paidDays:3,exitAt:"2026-09-11T11:00:00.000Z",
    prepaidMultiDay:true
  }),bad("PARKING_EXIT_BLOCKED"));
  assert.doesNotThrow(()=>parkingNormalExitAllowedV516({
    entryAt:entered,paidDays:3,exitAt:"2026-09-13T18:30:00.000Z",
    prepaidMultiDay:true
  }));
});

test("V5.16: recusa datas, anos ou timestamps inválidos sem tocar banco",()=>{
  for(const raw of ["not-a-date","2026-09-10","2026-09-10T15:30:00",""]){
    assert.throws(()=>parkingPaidUntilV516(raw,1),bad("INVALID_PARKING_INPUT"));
  }
  assert.throws(()=>parkingStateV516({entryAt:entered,paidDays:1,
    exitAt:"2026-09-09T17:00:00.000Z",now:"2026-09-12T00:00:00Z"
  }),bad("INVALID_PARKING_INPUT"));
});
