import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {createApp} from "../apps/api/src/server.ts";
const token=randomBytes(32).toString("base64url");
const mid="733c6075-bd63-48f8-b2a9-f21250e238df";
const protocol="JF-20261011-000001";
const path="/api/v1/guarda/transito/"+protocol;
const validResult="Veículo encontrado";
const validAction="Orientação realizada";
const headers={
 authorization:"Bearer "+token,
 "x-jeriflow-municipality-id":mid,
 "content-type":"application/json"
};
const accepted={protocolId:protocol,status:"EM ATENDIMENTO",alreadyProcessed:false};
const finished={protocolId:protocol,status:"FINALIZADA",alreadyProcessed:false};
const mocked={
 accept:async(actor,id,requestId)=>{
  assert.equal(actor.sessionToken,token);
  assert.equal(actor.municipalityId,mid);
  assert.equal(id,protocol);
  assert.match(requestId,/^[a-f0-9-]{36}$/);
  return accepted;
 },
 finish:async(actor,id,data)=>{
  assert.equal(actor.sessionToken,token);
  assert.equal(id,protocol);
  assert.equal(data.result,validResult);
  assert.equal(data.action,validAction);
  assert.equal(data.note,"Texto de ensaio");
  return finished;
 }
};
async function withServer(deps,fn){
 const server=createApp(undefined,undefined,undefined,undefined,deps);
 await new Promise((ok,fail)=>server.once("error",fail).listen(0,"127.0.0.1",ok));
 const address=server.address();assert(address&&typeof address!=="string");
 try{await fn("http://127.0.0.1:"+address.port);}
 finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
}
async function post(root,suffix,obj,options={}){
 const response=await fetch(root+path+suffix,{
  method:"POST",headers:{...headers,...options.headers},
  body:options.raw??JSON.stringify(obj)
 });
 return {status:response.status,body:await response.json(),headers:response.headers};
}
test("V5.16 HTTP de mutação: desligado até receber dependência explícita",async()=>{
 await withServer(undefined,async root=>{
  const result=await post(root,"/atender",{requestId:randomUUID()});
  assert.equal(result.status,503);
  assert.equal(result.body.error,"NOT_IMPLEMENTED");
 });
});
test("V5.16 HTTP mutações do guarda: aceitação e finalização sem campo de ator enviado",async()=>{
 let acceptedCalls=0,finishedCalls=0;
 await withServer({
  accept:async(...args)=>{acceptedCalls++;return mocked.accept(...args);},
  finish:async(...args)=>{finishedCalls++;return mocked.finish(...args);}
 },async root=>{
  const a=await post(root,"/atender",{requestId:randomUUID()});
  assert.equal(a.status,200);
  assert.equal(a.body.status,"EM ATENDIMENTO");
  const f=await post(root,"/finalizar",{
    requestId:randomUUID(),result:validResult,action:validAction,note:" Texto de ensaio "
  });
  assert.equal(f.status,200);
  assert.equal(f.body.status,"FINALIZADA");
  assert.equal(a.headers.get("cache-control"),"no-store");
  assert.equal(f.headers.get("access-control-allow-origin"),null);
  assert.equal(acceptedCalls,1);
  assert.equal(finishedCalls,1);
  for(const bad of [
   {requestId:randomUUID(),guardId:randomUUID()},
   {requestId:randomUUID(),municipalityId:mid},
   {requestId:"not-uuid"}
  ]){
   const r=await post(root,"/atender",bad);
   assert.equal(r.status,400);
  }
  assert.equal(acceptedCalls,1);
 });
});
test("V5.16 HTTP mutação: rejeita método, origem falsa, credencial ausente e dados de ação inventados",async()=>{
 let calls=0;
 await withServer({
  accept:async()=>{calls++;return accepted;},
  finish:async()=>{calls++;return finished;}
 },async root=>{
  const get=await fetch(root+path+"/atender",{method:"GET",headers});
  assert.equal(get.status,405);
  assert.equal(get.headers.get("allow"),"POST");
  const denied=await post(root,"/atender",{requestId:randomUUID()},
   {headers:{authorization:"Bearer fake"}});
  assert.equal(denied.status,401);
  assert.equal(denied.headers.get("www-authenticate"),"Bearer");
  const wrong=await post(root,"/atender",{requestId:randomUUID()},
   {headers:{"x-jeriflow-municipality-id":"another-municipality"}});
  assert.equal(wrong.status,401);
  for(const obj of [
   {requestId:randomUUID(),result:"Multa já aplicada",
     action:validAction,note:"Teste"},
   {requestId:randomUUID(),result:validResult,
     action:"Aviso enviado por WhatsApp",note:"Teste"},
   {requestId:randomUUID(),result:validResult,
     action:validAction,note:"x".repeat(2001)},
   {requestId:randomUUID(),result:validResult,
     action:validAction,note:"Teste",accountId:randomUUID()},
  ]){
   const result=await post(root,"/finalizar",obj);
   assert.equal(result.status,400);
  }
  assert.equal(calls,0);
 });
});
test("V5.16 HTTP mutação: JSON malformado, array, tamanho e tipo inválidos bloqueados",async()=>{
 let calls=0;
 await withServer({
  accept:async()=>{calls++;return accepted;},
  finish:async()=>{calls++;return finished;}
 },async root=>{
  for(const raw of ["{","[]","null","123"]){
   const r=await post(root,"/atender",{}, {raw});
   assert.equal(r.status,400);
  }
  const tooBig=await post(root,"/atender",{},
    {raw:JSON.stringify({requestId:randomUUID(),note:"x".repeat(5000)})});
  assert.equal(tooBig.status,413);
  const wrong=await post(root,"/atender",{requestId:randomUUID()},
    {headers:{"content-type":"text/plain"}});
  assert.equal(wrong.status,415);
  const zip=await post(root,"/atender",{requestId:randomUUID()},
    {headers:{"content-encoding":"gzip"}});
  assert.equal(zip.status,415);
  assert.equal(calls,0);
 });
});
test("V5.16 HTTP mutação: SQL negado/concorrência/erro não vazam dados privados",async()=>{
 const secret="PRIVATE_SQL_SERVER_TOKEN";
 for(const [code,status,expected] of [
  ["JF003",403,"GUARD_MUTATION_DENIED"],
  ["JF004",404,"GUARD_MUTATION_NOT_FOUND"],
  ["JF005",409,"GUARD_MUTATION_CONFLICT"],
  ["23505",409,"GUARD_MUTATION_CONFLICT"],
  ["XX999",503,"GUARD_MUTATION_UNAVAILABLE"]
 ]){
  await withServer({
   accept:async()=>{const err=new Error(secret);err.code=code;throw err;},
   finish:mocked.finish
  },async root=>{
   const r=await post(root,"/atender",{requestId:randomUUID()});
   assert.equal(r.status,status,code);
   assert.equal(r.body.error,expected);
   assert(!JSON.stringify(r.body).includes(secret));
  });
 }
});
test("V5.16 HTTP mutação: quatro requisições concorrentes no máximo",async()=>{
 let calls=0,release;
 const gate=new Promise(done=>release=done);
 await withServer({
  accept:async()=>{calls++;await gate;return accepted;},
  finish:mocked.finish
 },async root=>{
  const pending=Array.from({length:4},
    ()=>post(root,"/atender",{requestId:randomUUID()}));
  for(let i=0;i<200&&calls<4;i++)await new Promise(ok=>setTimeout(ok,5));
  try{
   assert.equal(calls,4);
   const fifth=await post(root,"/atender",{requestId:randomUUID()});
   assert.equal(fifth.status,429);
   assert.equal(fifth.body.error,"GUARD_MUTATION_BUSY");
   assert.equal(calls,4);
  }finally{release();}
  for(const r of await Promise.all(pending))assert.equal(r.status,200);
 });
});
