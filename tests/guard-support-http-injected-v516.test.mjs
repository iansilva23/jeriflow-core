import test from "node:test";
import assert from "node:assert/strict";
import {createApp} from "../apps/api/src/server.ts";
import {GUARD_SUPPORT_REASONS_V516} from "../apps/api/src/guard-support-service-v516.ts";
import {readFileSync} from "node:fs";

const mid="733c6075-bd63-48f8-b2a9-f21250e238df";
const id="94521636-4b86-46d1-8c5e-3644b1e15b51";
const protocol="JF-20261015-000001";
const postPath="/api/v1/guarda/transito/"+protocol+"/apoio";
const listPath="/api/v1/guarda/apoios";
const headers={Authorization:"Bearer "+"A".repeat(43),"X-JeriFlow-Municipality-Id":mid};
async function withServer(service,callback){
 const app=createApp(undefined,undefined,undefined,undefined,undefined,undefined,service);
 await new Promise((ok,fail)=>{app.once("error",fail);app.listen(0,"127.0.0.1",ok);});
 try{
  const info=app.address();assert(info&&typeof info!=="string");
  await callback("http://127.0.0.1:"+info.port);
 }finally{app.closeAllConnections();await new Promise(ok=>app.close(ok));}
}
function submit(base,body,opts={}){
 return fetch(base+postPath,{method:"POST",headers:{...headers,"Content-Type":"application/json",...opts},body:JSON.stringify(body)});
}
test("sem injeção, apoio não é ativado em main nem acessível na API",async()=>{
 await withServer(undefined,async base=>{
  const post=await submit(base,{requestId:id,reason:"Outro",note:"Registro fictício"});
  assert.equal(post.status,503);
  assert.equal((await post.json()).error,"NOT_IMPLEMENTED");
  assert.equal((await fetch(base+listPath,{headers})).status,503);
 });
 const main=readFileSync(new URL("../apps/api/src/main.ts",import.meta.url),"utf8");
 assert.doesNotMatch(main,/GuardSupportServiceV516|guard-support-http-v516/);
});
test("pedido com motivo exato é REGISTRADO e reenvio mantém o mesmo UUID",async()=>{
 const calls=[];
 const service={submit:async(...args)=>{
  calls.push(args);
  return {requestId:args[2],protocolId:args[1],recorded:true,alreadyProcessed:calls.length>1};
 },adminQueue:async()=>[]};
 await withServer(service,async base=>{
  for(const reason of GUARD_SUPPORT_REASONS_V516){
   const response=await submit(base,{requestId:id,reason,note:"Apoio fictício"});
   assert.equal(response.status,200);
   const value=await response.json();
   assert.equal(value.recorded,true);
   assert.equal(value.requestId,id);
   assert.equal(value.protocolId,protocol);
  }
  assert.equal(calls.length,4);
  assert.equal(calls[0][0].municipalityId,mid);
  assert.equal(calls[0][1],protocol);
  assert.equal(calls[0][2],id);
  assert.equal(calls[0][3],"Necessidade de outro agente");
  assert.equal(calls[0][4],"Apoio fictício");
 });
});
test("motivos não permitidos, campos extras, UUID e notas inválidas são rejeitados",async()=>{
 let invocations=0;
 const service={submit:async()=>{invocations++;throw Error("UNREACHABLE");},adminQueue:async()=>[]};
 await withServer(service,async base=>{
  for(const body of [
   {requestId:id,reason:"Viatura enviada",note:"a"},
   {requestId:id,reason:"Outro",note:"a",urgent:true},
   {requestId:"invalid",reason:"Outro",note:"a"},
   {requestId:id,reason:"Outro",note:"a".repeat(2001)},
   {requestId:id,reason:"Outro",note:"\u0000"}
  ]){
   const response=await submit(base,body);
   assert.equal(response.status,400);
  }
  assert.equal((await fetch(base+postPath,{headers})).status,405);
  assert.equal((await submit(base,{requestId:id,reason:"Outro",note:"a"}, {Authorization:"invalid"})).status,401);
  assert.equal(invocations,0);
 });
});
test("consulta admin: filtros estritos, proteção do papel e retorno de itens registrados",async()=>{
 const queries=[];
 const service={submit:async()=>{throw Error("UNREACHABLE");},adminQueue:async(...args)=>{
  queries.push(args);
  return [{requestId:id,protocolId:protocol,reason:"Outro",note:"Registro",createdAt:"2026-10-15T00:00:00Z",guardName:"Guarda Fictício"}];
 }};
 await withServer(service,async base=>{
  const response=await fetch(base+listPath+"?after="+id+"&limit=1",{headers});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.items[0].reason,"Outro");
  assert.equal(queries[0][1],id);
  assert.equal(queries[0][2],1);
  for(const query of ["?limit=51","?limit=00","?limit=1&limit=2","?after=invalid","?access=all"]){
   assert.equal((await fetch(base+listPath+query,{headers})).status,400);
  }
  assert.equal(queries.length,1);
  assert.equal((await fetch(base+listPath,{method:"POST",headers})).status,405);
 });
});
test("negação, protocolo inexistente e conflito são tratados sem vazamento",async()=>{
 for(const [code,status] of [["JF003",403],["JF004",404],["JF005",409]]){
  const service={submit:async()=>{const error=new Error("Internal secret");error.code=code;throw error;},
   adminQueue:async()=>{const error=new Error("Internal secret");error.code=code;throw error;}};
  await withServer(service,async base=>{
   const response=await submit(base,{requestId:id,reason:"Outro",note:"Teste"});
   assert.equal(response.status,status);
   const text=JSON.stringify(await response.json());
   assert(!text.includes("Internal secret"));
   assert.equal((await fetch(base+listPath,{headers})).status,status);
  });
 }
});
