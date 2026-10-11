import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {guardAuthenticatedTransportV516} from "../apps/guarda/guard-authenticated-transport-v516.ts";
const token=randomBytes(32).toString("base64url");
const mid="733c6075-bd63-48f8-b2a9-f21250e238df";
test("V5.16 transporte Guarda autenticado preserva token fora da URL",async()=>{
 let calls=0;
 const transport=guardAuthenticatedTransportV516({
  endpoint:"https://api.example.test",municipalityId:mid,readToken:async()=>token,
  request:async(url,init)=>{
   calls++;
   assert.equal(url,"https://api.example.test/api/v1/guarda/transito?filter=ALL&limit=20");
   assert.equal(init.headers.Authorization,"Bearer "+token);
   assert.equal(init.headers["X-JeriFlow-Municipality-Id"],mid);
   assert.equal(init.method,"GET");
   assert.equal(init.cache,"no-store");
   return new Response(JSON.stringify({items:[]}),{status:200});
  }
 });
 assert.deepEqual(await transport("/api/v1/guarda/transito?filter=ALL&limit=20"),{items:[]});
 assert.equal(calls,1);
});
test("V5.16 transporte Guarda rejeita rotas indevidas e falta de sessão",async()=>{
 let calls=0;
 const transport=guardAuthenticatedTransportV516({
  endpoint:"https://api.example.test",municipalityId:mid,readToken:async()=>null,
  request:async()=>{calls++;throw Error("não deve acessar rede");}
 });
 await assert.rejects(transport("/api/v1/guarda/transito"),/UNAUTHORIZED/);
 await assert.rejects(transport("/api/v1/citizen/traffic"),/INVALID_INPUT/);
 await assert.rejects(transport("/api/v1/guarda/transito?token=secret"),/INVALID_INPUT/);
 await assert.rejects(transport("/api/v1/guarda/transito/JF-20261011-000001/atender","GET"),/INVALID_INPUT/);
 assert.equal(calls,0);
});
test("V5.16 transporte Guarda rejeita respostas e erros sem expor segredos",async()=>{
 const t=guardAuthenticatedTransportV516({endpoint:"https://api.example.test",municipalityId:mid,
  readToken:async()=>token,request:async()=>new Response(JSON.stringify({error:"GUARD_ACCESS_DENIED"}),{status:403})});
 await assert.rejects(t("/api/v1/guarda/transito"),e=>e.code==="GUARD_ACCESS_DENIED"&&e.status===403&&!String(e).includes(token));
});

test("V5.16 transporte bloqueia parâmetros inválidos antes de ler a sessão",async()=>{
 let tokens=0, calls=0;
 const transport=guardAuthenticatedTransportV516({
  endpoint:"https://api.example.test",municipalityId:mid,
  readToken:async()=>{tokens++;return token;},
  request:async()=>{calls++;return new Response(JSON.stringify({items:[]}));}
 });
 for(const path of [
  "/api/v1/guarda/transito?filter=HACK",
  "/api/v1/guarda/transito?limit=51",
  "/api/v1/guarda/transito?limit=0",
  "/api/v1/guarda/transito?after=JF-20261011-0000001",
  "/api/v1/guarda/transito?after=JF-20261011-00001",
  "/api/v1/guarda/transito?filter=ALL&filter=NEW",
  "/api/v1/guarda/transito?filter=ALL#token"
 ]){
  await assert.rejects(transport(path),/INVALID_INPUT/,path);
 }
 assert.equal(tokens,0);
 assert.equal(calls,0);
});
