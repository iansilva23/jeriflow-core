import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {entryDraftMutation,entryDraftQuery,entryDraftHistory} from "../apps/api/src/parking-entry-input.ts";
import {authMethods} from "../packages/contracts/src/identity.ts";
import {identityRoutes} from "../apps/api/src/identity-http.ts";
const municipalityId=randomUUID(),entryId=randomUUID(),clientRequestId=randomUUID();
const entry={municipalityId,operation:"enter",clientRequestId,vehiclePlate:"ABC1D23",
 vehicleBrand:"Marca fictícia",vehicleModel:"Modelo fictício",areaText:"Área simulada do estacionamento"};
test("cadastro experimental de veículos: entrada, saída e contratos estritos",()=>{
 assert.equal(entryDraftMutation(entry).vehiclePlate,"ABC1D23");
 assert.equal(entryDraftMutation({...entry,lodgingName:"Pousada fictícia"}).lodgingName,"Pousada fictícia");
 assert.equal(entryDraftMutation(entry).lodgingName,null);
 assert.deepEqual(entryDraftQuery({municipalityId}),{municipalityId,after:null});
 assert.equal(entryDraftQuery({municipalityId,after:entryId}).after,entryId);
 assert.equal(entryDraftHistory({municipalityId,entryId}).entryId,entryId);
 assert.equal(entryDraftMutation({municipalityId,operation:"depart",entryId,revision:1}).revision,1);
 for(const bad of [
  {...entry,vehiclePlate:"abc1D23"},{...entry,vehiclePlate:"INVALID"},
  {...entry,vehicleBrand:"x"},{...entry,vehicleModel:"x"},
  {...entry,areaText:"a"}, {...entry,lodgingName:"x"},
  {...entry,amount:40},{...entry,paidUntil:"2026-10-12"},
  {...entry,actualExit:"2026-10-13"},{...entry,clientRequestId:"invalid"},
  {...entry,entryId},{...entry,revision:1},
  {municipalityId,operation:"depart",entryId,revision:0},
  {municipalityId,operation:"depart",entryId,revision:1,payment:true},
  {municipalityId,operation:"depart",entryId,revision:1,lodgingName:"Pousada"},
  {municipalityId,operation:"complete",entryId,revision:1}
 ]) assert.throws(()=>entryDraftMutation(bad));
 assert.throws(()=>entryDraftQuery({municipalityId,scope:"queue"}));
 assert.throws(()=>entryDraftHistory({municipalityId,entryId,admin:true}));
 for(const path of ["/parking/entries/query","/parking/entries/mutate","/parking/entries/history"]){
  assert.equal(authMethods[path],"POST");
  assert.equal(identityRoutes["/api/v1"+path],"POST");
 }
 assert.equal(authMethods["/parking/entries/charge"],undefined);
 assert.equal(identityRoutes["/api/v1/parking/entries/permit"],undefined);
});