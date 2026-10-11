import test from "node:test";
import assert from "node:assert/strict";
import {guardReadClientV516} from "../apps/guarda/guard-read-client-v516.ts";
const protocol="JF-20261011-000001";
test("cliente leitura constrói fila/detalhe sem token ou acesso direto ao banco",async()=>{
 const calls=[];
 const client=guardReadClientV516(async path=>{calls.push(path);
  return path.includes("?")?{items:[],filter:"NEW"}:{protocolId:protocol,status:"RECEBIDA"};
 });
 await client.list("NEW",protocol,10);
 await client.detail(protocol);
 assert.equal(calls[0],"/api/v1/guarda/transito?filter=NEW&limit=10&after="+protocol);
 assert.equal(calls[1],"/api/v1/guarda/transito/"+protocol);
});
test("cliente leitura bloqueia opções inventadas e protocolos longos sem rede",async()=>{
 let calls=0;
 const client=guardReadClientV516(async()=>{calls++;return {items:[]};});
 await assert.rejects(client.list("FAKE"),/INVALID_GUARD_QUERY/);
 await assert.rejects(client.list("ALL","JF-20261011-0000001"),/INVALID_GUARD_QUERY/);
 await assert.rejects(client.list("ALL",null,51),/INVALID_GUARD_QUERY/);
 await assert.rejects(client.detail("JF-20261011-0000001"),/INVALID_GUARD_QUERY/);
 assert.equal(calls,0);
});
test("cliente leitura recusa resposta incompatível",async()=>{
 const client=guardReadClientV516(async()=>({protocolId:"JF-20261011-000002"}));
 await assert.rejects(client.list(),/INVALID_GUARD_RESPONSE/);
 await assert.rejects(client.detail(protocol),/INVALID_GUARD_RESPONSE/);
});
