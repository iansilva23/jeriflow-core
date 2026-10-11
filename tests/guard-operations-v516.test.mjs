import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {guardOperationsV516} from "../apps/guarda/guard-operations-v516.ts";
const mid="733c6075-bd63-48f8-b2a9-f21250e238df",p="JF-20261011-000001";
test("composição da Guarda encaminha somente pelo transporte de sessão",async()=>{
 const calls=[];
 const t={clear:async()=>{},request:async()=>{throw Error("not identity");},
  guardRequest:async(m,path,method,body)=>{
   calls.push({m,path,method,body});
   if(path.includes("?"))return {items:[]};
   if(path.endsWith("/atender"))return {protocolId:p,status:"EM ATENDIMENTO"};
   if(path.endsWith("/finalizar"))return {protocolId:p,status:"FINALIZADA"};
   return {protocolId:p,status:"RECEBIDA"};
  }};
 const ops=guardOperationsV516(t,mid);
 await ops.list();await ops.detail(p);await ops.accept(p,randomUUID());
 await ops.finish(p,{requestId:randomUUID(),result:"Veículo encontrado",action:"Orientação realizada",note:"Conferido"});
 assert.equal(calls.length,4);
 assert(calls.every(x=>x.m===mid));
 assert.deepEqual(calls.map(x=>x.method),["GET","GET","POST","POST"]);
 assert(calls.every(x=>!JSON.stringify(x).includes("Bearer ")));
});
test("composição recusa transporte sem canal protegido",()=>{
 assert.throws(()=>guardOperationsV516({clear:async()=>{},request:async()=>({})},mid),e=>e.code==="NOT_CONFIGURED");
});
