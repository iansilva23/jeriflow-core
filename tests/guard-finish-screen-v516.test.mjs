import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {guardScreenActionsV516} from "../apps/guarda/guard-screen-actions-v516.ts";
import {GUARD_RESULTS_V516,GUARD_ACTIONS_V516} from "../apps/guarda/guard-service-v516.ts";

const mid="733c6075-bd63-48f8-b2a9-f21250e238df",p="JF-20261012-000001";
test("Formulário RN oferece as 4 situações e 5 providências originais da V5.16",()=>{
 assert.deepEqual(GUARD_RESULTS_V516,[
  "Veículo encontrado","Veículo não encontrado","Situação já resolvida","Denúncia não confirmada"]);
 assert.deepEqual(GUARD_ACTIONS_V516,[
  "Orientação realizada","Autuação realizada","Veículo removido/direcionado",
  "Solicitado apoio","Sem providência necessária"]);
 const ui=readFileSync("apps/guarda/GuardFinishPanelV516.tsx","utf8");
 const screen=readFileSync("apps/guarda/GuardQueueScreenV516.tsx","utf8");
 assert(ui.includes("Confirmar finalização")&&ui.includes("Revisar finalização"));
 assert(ui.includes("maxLength={2000}"));
 assert(ui.includes("GUARD_RESULTS_V516.map")&&ui.includes("GUARD_ACTIONS_V516.map"));
 assert(screen.includes('selected.status==="EM ATENDIMENTO"'));
 assert(screen.includes('setFilter("FINISHED")')&&screen.includes('setFilter("IN_SERVICE")'));
 assert(!ui.includes("fetch(")&&!ui.includes("SecureStore"));
});
test("Finalização RN mantém município, token fechado e requestId seguro",async()=>{
 const calls=[];
 const transport={clear:async()=>{},request:async()=>{throw Error("IDENTITY_NOT_CALLED");},
  guardRequest:async(m,path,method,body)=>{calls.push({m,path,method,body});
   if(path.endsWith("/finalizar"))return {protocolId:p,status:"FINALIZADA"};
   throw Error("UNEXPECTED_PATH");
  }};
 const a=guardScreenActionsV516(transport,mid,randomUUID);
 await a.finish(p,{result:"Veículo encontrado",action:"Orientação realizada",note:"Observação de teste"});
 assert.equal(calls.length,1);
 assert.equal(calls[0].m,mid);assert.equal(calls[0].method,"POST");
 assert.equal(calls[0].path,"/api/v1/guarda/transito/"+p+"/finalizar");
 assert.equal(calls[0].body.result,"Veículo encontrado");
 assert.equal(calls[0].body.action,"Orientação realizada");
 assert.equal(calls[0].body.note,"Observação de teste");
 assert.match(calls[0].body.requestId,/^[0-9a-f-]{36}$/i);
});
test("Finalização RN rejeita id inválido e opções fora do contrato, sem chamar servidor",async()=>{
 let calls=0;
 const transport={clear:async()=>{},request:async()=>({}),
  guardRequest:async()=>{calls++;return {protocolId:p,status:"FINALIZADA"};}};
 const a=guardScreenActionsV516(transport,mid,randomUUID);
 await assert.rejects(a.finish("PROTOCOLO-INVÁLIDO",{
  result:"Veículo encontrado",action:"Orientação realizada",note:""
 }),/INVALID_GUARD_MUTATION/);
 await assert.rejects(a.finish(p,{
  result:"Opção que não existe",action:"Orientação realizada",note:""
 }),/INVALID_GUARD_MUTATION/);
 assert.equal(calls,0);
});
