import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {guardScreenActionsV516} from "../apps/guarda/guard-screen-actions-v516.ts";
import {commitGuardAndRefreshV516} from "../apps/guarda/guard-ui-commit-v516.ts";

// Matriz de falhas exclusivamente sintética: sem credenciais, servidores ou dados reais.
// O HTML original V5.16 exige o mesmo protocolo ao atender e finalizar.
const municipality="733c6075-bd63-48f8-b2a9-f21250e238df";
const protocol="JF-20261013-000001";
const finishData={result:"Situação já resolvida",action:"Sem providência necessária",note:"Registro fictício"};

test("resposta do POST perdida após persistência: reenvio de ATENDER mantém requestId original",async()=>{
 const seen=[];
 let committed=0;
 const transport={
  clear:async()=>{},
  request:async()=>({}),
  guardRequest:async(_mid,path,method,body)=>{
   assert.equal(_mid,municipality);
   assert.equal(method,"POST");
   assert.equal(path,`/api/v1/guarda/transito/${protocol}/atender`);
   seen.push(body.requestId);
   if(committed++===0)throw new Error("ACK_LOST_AFTER_COMMIT");
   return {protocolId:protocol,status:"EM ATENDIMENTO"};
  }
 };
 const actions=guardScreenActionsV516(transport,municipality,randomUUID);
 await assert.rejects(actions.accept(protocol),/ACK_LOST_AFTER_COMMIT/);
 await actions.accept(protocol);
 assert.equal(seen.length,2);
 assert.equal(seen[0],seen[1]);
 await assert.rejects(actions.accept(protocol),/GUARD_OPERATION_ALREADY_CONFIRMED/);
 assert.equal(seen.length,2);
});

test("FINALIZAR com resposta perdida preserva payload e UUID; novo formulário é rejeitado",async()=>{
 const seen=[];
 let committed=0;
 const transport={
  clear:async()=>{},
  request:async()=>({}),
  guardRequest:async(_mid,path,method,body)=>{
   assert.equal(_mid,municipality);
   assert.equal(method,"POST");
   assert.equal(path,`/api/v1/guarda/transito/${protocol}/finalizar`);
   seen.push({requestId:body.requestId,result:body.result,action:body.action,note:body.note});
   if(committed++===0)throw new Error("ACK_LOST_AFTER_COMMIT");
   return {protocolId:protocol,status:"FINALIZADA"};
  }
 };
 const actions=guardScreenActionsV516(transport,municipality,randomUUID);
 await assert.rejects(actions.finish(protocol,finishData),/ACK_LOST_AFTER_COMMIT/);
 await assert.rejects(
  actions.finish(protocol,{...finishData,note:"Mudança não permitida no retry"}),
  /GUARD_RETRY_PAYLOAD_CHANGED/
 );
 assert.equal(seen.length,1,"payload alterado não chega ao backend");
 await actions.finish(protocol,{...finishData});
 assert.equal(seen.length,2);
 assert.deepEqual(seen[0],seen[1]);
 await assert.rejects(actions.finish(protocol,finishData),/GUARD_OPERATION_ALREADY_CONFIRMED/);
});

test("POST confirmado e atualização da fila offline não desfaz o sucesso",async()=>{
 let confirmations=0,refreshes=0;
 const result=await commitGuardAndRefreshV516(
  async()=>{confirmations++;},
  async()=>{refreshes++;throw new Error("NETWORK_OFFLINE_AFTER_COMMIT");}
 );
 assert.equal(confirmations,1);
 assert.equal(refreshes,1);
 assert.deepEqual(result,{committed:true,items:null});
});

test("POST não confirmado não executa atualização posterior nem declara sucesso",async()=>{
 let refreshed=false;
 await assert.rejects(commitGuardAndRefreshV516(
  async()=>{throw new Error("UNKNOWN_OUTCOME");},
  async()=>{refreshed=true;return [];}
 ),/UNKNOWN_OUTCOME/);
 assert.equal(refreshed,false);
});
