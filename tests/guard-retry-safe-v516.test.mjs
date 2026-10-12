import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {commitGuardAndRefreshV516} from "../apps/guarda/guard-ui-commit-v516.ts";
import {guardScreenActionsV516} from "../apps/guarda/guard-screen-actions-v516.ts";
const mid="733c6075-bd63-48f8-b2a9-f21250e238df";
const protocol="JF-20261012-000001";

test("se o servidor gravou o atendimento mas GET falhou, resultado continua confirmado",async()=>{
 const calls=[];
 const result=await commitGuardAndRefreshV516(
  async()=>calls.push("ATENDIMENTO_GRAVADO"),
  async()=>{calls.push("RECARGA_FALHOU");throw Error("NETWORK");}
 );
 assert.deepEqual(calls,["ATENDIMENTO_GRAVADO","RECARGA_FALHOU"]);
 assert.deepEqual(result,{committed:true,items:null});
});
test("quando POST falha, não consulta nem trata operação como concluída",async()=>{
 let loads=0;
 await assert.rejects(commitGuardAndRefreshV516(
  async()=>{throw Error("UNKNOWN_OUTCOME");},
  async()=>{loads++;return [];}
 ),/UNKNOWN_OUTCOME/);
 assert.equal(loads,0);
});
test("recarga bem-sucedida preserva itens canônicos",async()=>{
 const items=[{protocolId:protocol,status:"EM ATENDIMENTO"}];
 assert.deepEqual(await commitGuardAndRefreshV516(
  async()=>{},async()=>items),{committed:true,items});
});
test("tentativa de ATENDER com falha temporária reutiliza o mesmo UUID e não duplica após 200",async()=>{
 const ids=[];
 const transport={clear:async()=>{},request:async()=>({}),
  guardRequest:async(midArg,path,method,body)=>{
   assert.equal(midArg,mid);assert.equal(method,"POST");
   assert.equal(path,"/api/v1/guarda/transito/"+protocol+"/atender");
   ids.push(body.requestId);
   if(ids.length===1)throw Error("NETWORK");
   return {protocolId:protocol,status:"EM ATENDIMENTO"};
  }};
 const actions=guardScreenActionsV516(transport,mid,randomUUID);
 await assert.rejects(actions.accept(protocol),/NETWORK/);
 await actions.accept(protocol);
 assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
 await assert.rejects(actions.accept(protocol),/GUARD_OPERATION_ALREADY_CONFIRMED/);
 assert.equal(ids.length,2);
});
test("FINALIZAR bloqueia mudança de dados em retry ambíguo e apaga payload após confirmação",async()=>{
 const ids=[];
 const data={result:"Situação já resolvida",action:"Sem providência necessária",note:"Tudo resolvido"};
 const transport={clear:async()=>{},request:async()=>({}),
  guardRequest:async(_mid,_path,method,body)=>{
   assert.equal(method,"POST");ids.push(body.requestId);
   if(ids.length===1)throw Error("NETWORK");
   return {protocolId:protocol,status:"FINALIZADA"};
  }};
 const actions=guardScreenActionsV516(transport,mid,randomUUID);
 await assert.rejects(actions.finish(protocol,data),/NETWORK/);
 await assert.rejects(actions.finish(protocol,{...data,note:"Texto alterado"}),/GUARD_RETRY_PAYLOAD_CHANGED/);
 assert.equal(ids.length,1);
 await actions.finish(protocol,{...data});
 assert.deepEqual(ids,[ids[0],ids[0]]);
 await assert.rejects(actions.finish(protocol,data),/GUARD_OPERATION_ALREADY_CONFIRMED/);
});
test("falha de validação local não bloqueia correção do formulário",async()=>{
 const ids=[];
 const transport={clear:async()=>{},request:async()=>({}),
  guardRequest:async(_mid,_path,_method,body)=>{
   ids.push(body.requestId);return {protocolId:protocol,status:"FINALIZADA"};
  }};
 const actions=guardScreenActionsV516(transport,mid,randomUUID);
 await assert.rejects(actions.finish(protocol,{
  result:"Valor inexistente",action:"Sem providência necessária",note:""
 }),/INVALID_GUARD_MUTATION/);
 await actions.finish(protocol,{
  result:"Situação já resolvida",action:"Sem providência necessária",note:""
 });
 assert.equal(ids.length,1);
});
test("tela mantém bloqueio síncrono e mensagens distintas após sucesso de POST",()=>{
 const screen=readFileSync("apps/guarda/GuardQueueScreenV516.tsx","utf8");
 assert(screen.includes("if(busyRef.current)return;"));
 assert(screen.includes("Atendimento registrado, mas a fila não atualizou."));
 assert(screen.includes("Ocorrência finalizada, mas a fila não atualizou."));
 assert(screen.includes("commitGuardAndRefreshV516("));
});
