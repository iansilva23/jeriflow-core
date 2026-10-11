import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {guardScreenActionsV516} from "../apps/guarda/guard-screen-actions-v516.ts";
const mid="733c6075-bd63-48f8-b2a9-f21250e238df",id="JF-20261011-000001";
test("tela Guarda usa operações da sessão protegida e campos canônicos",async()=>{
 const calls=[];
 const transport={clear:async()=>{},request:async()=>{throw Error("identity");},
 guardRequest:async(m,path,method,body)=>{
 calls.push({m,path,method,body});
 if(path.includes("?"))return {items:[{protocolId:id,title:"Estacionamento irregular",location:"Rua A",status:"RECEBIDA"}]};
 if(path.endsWith("/atender"))return {protocolId:id,status:"EM ATENDIMENTO"};
 return {protocolId:id,status:"RECEBIDA",location:"Rua A"};
 }};
 const actions=guardScreenActionsV516(transport,mid,randomUUID);
 const items=await actions.load("NEW");assert.equal(items.length,1);
 assert.equal((await actions.open(id)).protocolId,id);
 await actions.accept(id);
 assert.deepEqual(calls.map(x=>x.method),["GET","GET","POST"]);
 assert(calls.every(x=>x.m===mid));
 assert.match(calls[2].body.requestId,/^[a-f0-9-]{36}$/);
});
test("tela Guarda recusa itens inválidos e UUID malformado",async()=>{
 let accepted=0;
 const transport={clear:async()=>{},request:async()=>({}),
 guardRequest:async(m,path)=>{
 if(path.includes("?"))return {items:[{protocolId:"JF-20261011-0000001",status:"RECEBIDA",title:"a",location:"b"}]};
 accepted++;return {protocolId:id,status:"EM ATENDIMENTO"};
 }};
 const actions=guardScreenActionsV516(transport,mid,()=> "not-uuid");
 await assert.rejects(actions.load("NEW"),/INVALID_GUARD_RESPONSE/);
 await assert.rejects(actions.accept(id),/INVALID_GUARD_REQUEST_ID/);
 assert.equal(accepted,0);
});
