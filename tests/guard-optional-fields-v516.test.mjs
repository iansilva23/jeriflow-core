import test from "node:test";
import assert from "node:assert/strict";
import {guardScreenActionsV516} from "../apps/guarda/guard-screen-actions-v516.ts";
const municipalityId="733c6075-bd63-48f8-b2a9-f21250e238df";
test("V5.16: denúncia com título e local opcionais permanece visível",async()=>{
 const transport={request:async()=>({}),clear:async()=>{},guardRequest:async()=>({items:[{protocolId:"JF-20261011-000001",status:"RECEBIDA",title:null,location:null}]})};
 const result=await guardScreenActionsV516(transport,municipalityId,()=>municipalityId).load("NEW");
 assert.equal(result.length,1);
 assert.equal(result[0].protocolId,"JF-20261011-000001");
 assert.equal(result[0].title,undefined);
 assert.equal(result[0].location,undefined);
});
test("V5.16: a validação permanece estrita para protocolos inválidos",async()=>{
 const transport={request:async()=>({}),clear:async()=>{},guardRequest:async()=>({items:[{protocolId:"INVALID",status:"RECEBIDA",title:null,location:null}]})};
 await assert.rejects(guardScreenActionsV516(transport,municipalityId,()=>municipalityId).load("NEW"),/INVALID_GUARD_RESPONSE/);
});
