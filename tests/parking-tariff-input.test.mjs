import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {tariffDraftQuery,tariffDraftMutation,tariffDraftHistory} from "../apps/api/src/parking-tariff-input.ts";
import {authMethods} from "../packages/contracts/src/identity.ts";
import {identityRoutes} from "../apps/api/src/identity-http.ts";
const municipalityId=randomUUID(),entryId=randomUUID(),clientRequestId=randomUUID();
const body={municipalityId,clientRequestId,revision:0,dailyRateCents:4000,
 rationale:"Valor fictício de teste, sem aprovação institucional."};
test("tarifa experimental: nunca há aprovação nem solicitação de cobrança",()=>{
 assert.equal(tariffDraftMutation(body).dailyRateCents,4000);
 assert.equal(tariffDraftMutation({...body,revision:2}).revision,2);
 assert.deepEqual(tariffDraftQuery({municipalityId}),{municipalityId,entryId:null});
 assert.equal(tariffDraftQuery({municipalityId,entryId}).entryId,entryId);
 assert.deepEqual(tariffDraftHistory({municipalityId}),{municipalityId});
 for(const bad of [
  {...body,dailyRateCents:0},{...body,dailyRateCents:-1},
  {...body,dailyRateCents:1000001},{...body,dailyRateCents:4000.2},
  {...body,revision:-1},{...body,revision:1.3},
  {...body,rationale:"curto"},{...body,rationale:"x".repeat(501)},
  {...body,rationale:"Linha com\nquebra ilegítima."},
  {...body,paymentMethod:"pix"},{...body,approved:true},
  {...body,clientRequestId:"invalid"},
 ])assert.throws(()=>tariffDraftMutation(bad));
 for(const bad of [
  {municipalityId,entryId,scope:"public"},{municipalityId,amount:50},
  {municipalityId,entryId:"invalid"},
 ])assert.throws(()=>tariffDraftQuery(bad));
 assert.throws(()=>tariffDraftHistory({municipalityId,approved:true}));
 for(const suffix of ["query","mutate","history"]){
  assert.equal(authMethods["/parking/tariff/"+suffix],"POST");
  assert.equal(identityRoutes["/api/v1/parking/tariff/"+suffix],"POST");
 }
 assert.equal(authMethods["/parking/pay"],undefined);
 assert.equal(identityRoutes["/api/v1/parking/paid"],undefined);
});
