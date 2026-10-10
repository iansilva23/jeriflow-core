import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {parkingMutation,parkingQuery,parkingHistory} from "../apps/api/src/parking-input.ts";
import {authMethods} from "../packages/contracts/src/identity.ts";
import {identityRoutes} from "../apps/api/src/identity-http.ts";
const municipalityId=randomUUID(),requestId=randomUUID(),clientRequestId=randomUUID();
const created={municipalityId,operation:"create",clientRequestId,vehiclePlate:"ABC1D23",
 areaText:"Zona fictícia do estacionamento",serviceDay:"2026-10-10",
 description:"Solicitação fictícia de estacionamento"};
test("Turismo: contrato estrito e serviço sem pagamento",()=>{
 assert.equal(parkingMutation(created).vehiclePlate,"ABC1D23");
 assert.deepEqual(parkingQuery({municipalityId,scope:"mine"}),{municipalityId,scope:"mine",after:null});
 assert.equal(parkingQuery({municipalityId,scope:"queue",after:requestId}).after,requestId);
 assert.equal(parkingHistory({municipalityId,requestId}).requestId,requestId);
 assert.equal(parkingMutation({municipalityId,operation:"triage",requestId,revision:1}).revision,1);
 assert.equal(parkingMutation({municipalityId,operation:"answer",requestId,revision:2,
  message:"Verificação concluída sem pagamento."}).operation,"answer");
 for(const bad of [
  {...created,vehiclePlate:"ABC 123"}, {...created,vehiclePlate:"abc1234"},
  {...created,serviceDay:"2026-02-30"},{...created,serviceDay:"10/10/2026"},
  {...created,areaText:"x"}, {...created,description:"curto"},
  {...created,amount:100}, {...created,clientRequestId:"invalido"},
  {municipalityId,operation:"triage",requestId,revision:0},
  {municipalityId,operation:"answer",requestId,revision:2,message:"curto"},
  {municipalityId,operation:"reject",requestId,revision:2,message:"ok",payment:true}
 ]) assert.throws(()=>parkingMutation(bad));
 assert.throws(()=>parkingQuery({municipalityId,scope:"admin"}));
 assert.throws(()=>parkingHistory({municipalityId,requestId,admin:true}));
 for(const path of ["/parking/requests/query","/parking/requests/mutate","/parking/requests/history"]){
  assert.equal(authMethods[path],"POST");
  assert.equal(identityRoutes["/api/v1"+path],"POST");
 }
 assert.equal(authMethods["/parking/permit/issue"],undefined);
 assert.equal(identityRoutes["/api/v1/parking/pay"],undefined);
});
