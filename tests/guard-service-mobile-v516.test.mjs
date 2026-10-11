import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {guardServiceV516, GUARD_ACTIONS_V516, GUARD_RESULTS_V516} from "../apps/guarda/guard-service-v516.ts";
const protocol="JF-20261011-000001";
test("contrato RN Guarda atende e finaliza com protocolo único",async()=>{
 const calls=[];
 const client=guardServiceV516(async(path,method,body)=>{
  calls.push({path,method,body});
  return {protocolId:protocol,status:path.endsWith("/atender")?"EM ATENDIMENTO":"FINALIZADA"};
 });
 await client.accept(protocol,randomUUID());
 await client.finish(protocol,{requestId:randomUUID(),result:GUARD_RESULTS_V516[0],action:GUARD_ACTIONS_V516[0],note:"  Verificado  "});
 assert.equal(calls.length,2);
 assert.equal(calls[0].method,"POST");
 assert.equal(calls[0].path,"/api/v1/guarda/transito/"+protocol+"/atender");
 assert.equal(calls[1].body.note,"Verificado");
 assert.deepEqual(Object.keys(calls[1].body).sort(),["action","note","requestId","result"]);
});
test("contrato RN Guarda bloqueia valores inventados antes da rede",async()=>{
 let calls=0;
 const client=guardServiceV516(async()=>{calls++;return {};});
 await assert.rejects(client.accept("JF-20261011-0000001",randomUUID()),/INVALID_GUARD_MUTATION/);
 await assert.rejects(client.accept(protocol,"invalid"),/INVALID_GUARD_MUTATION/);
 await assert.rejects(client.finish(protocol,{requestId:randomUUID(),result:"Multa automática",action:GUARD_ACTIONS_V516[0],note:""}),/INVALID_GUARD_MUTATION/);
 assert.equal(calls,0);
});
test("contrato RN Guarda recusa resposta de protocolo ou status trocados",async()=>{
 const client=guardServiceV516(async()=>({protocolId:"JF-20261011-000002",status:"FINALIZADA"}));
 await assert.rejects(client.accept(protocol,randomUUID()),/INVALID_GUARD_RESPONSE/);
});
