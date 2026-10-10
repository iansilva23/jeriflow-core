import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {planningQuery,planningExtend} from "../apps/api/src/parking-planning-input.ts";
import {authMethods} from "../packages/contracts/src/identity.ts";
import {identityRoutes} from "../apps/api/src/identity-http.ts";
const municipalityId=randomUUID(),entryId=randomUUID(),clientRequestId=randomUUID();
const extension={municipalityId,entryId,clientRequestId,revision:1,extraDays:1};
test("permanência fictícia: modos e contrato de extensão de 24h",()=>{
 assert.deepEqual(planningQuery({municipalityId}),{municipalityId,mode:"all",after:null});
 assert.equal(planningQuery({municipalityId,mode:"needs_review"}).mode,"needs_review");
 for(const mode of ["all","present","needs_review","departed"])
  assert.equal(planningQuery({municipalityId,mode,after:entryId}).after,entryId);
 assert.deepEqual(planningExtend(extension),extension);
 assert.equal(planningExtend({...extension,extraDays:30}).extraDays,30);
 for(const bad of [
  {...extension,extraDays:0},{...extension,extraDays:31},
  {...extension,extraDays:1.2},{...extension,revision:0},
  {...extension,revision:1.1},{...extension,price:40},
  {...extension,payment:"pix"},{...extension,clientRequestId:"invalid"},
  {entryId,revision:1,clientRequestId,extraDays:1},
 ])assert.throws(()=>planningExtend(bad));
 for(const bad of [
  {municipalityId,mode:"paid"},{municipalityId,mode:"due"},{municipalityId,payment:true},
  {municipalityId,mode:0},{municipalityId,after:"invalid"},
 ])assert.throws(()=>planningQuery(bad));
 assert.equal(authMethods["/parking/entries/extend"],"POST");
 assert.equal(identityRoutes["/api/v1/parking/entries/extend"],"POST");
 assert.equal(authMethods["/parking/entries/payment"],undefined);
});
