import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {createApp} from "../apps/api/src/server.ts";
import {GuardTrafficReadHttpErrorV516} from "../apps/api/src/guard-traffic-read-http-v516.ts";

const token=randomBytes(32).toString("base64url");
const mid="733c6075-bd63-48f8-b2a9-f21250e238df";
const path="/api/v1/guarda/transito";
const protocol="JF-20261011-000001";

async function withServer(deps,fn){
 const server=createApp(undefined,undefined,undefined,deps);
 await new Promise((ok,fail)=>server.once("error",fail).listen(0,"127.0.0.1",ok));
 try{
  const address=server.address();
  assert(address&&typeof address!=="string");
  await fn("http://127.0.0.1:"+address.port);
 }finally{
  server.closeAllConnections();
  await new Promise(ok=>server.close(ok));
 }
}
const headers={authorization:"Bearer "+token,"x-jeriflow-municipality-id":mid};
async function request(root,p,options={}){
 const response=await fetch(root+p,{...options,headers:{...headers,...options.headers}});
 return {status:response.status,body:await response.json(),headers:response.headers};
}
const backend={
 list:async(ctx,filter,after,limit)=>{
  assert.equal(ctx.sessionToken,token);assert.equal(ctx.municipalityId,mid);
  return {items:[{protocolId:protocol,status:"RECEBIDA"}],filter,after,limit};
 },
 detail:async(ctx,id)=>({protocolId:id,status:"RECEBIDA",
   reporter:{name:"Pessoa sintética",phone:"00000000000"}})
};
test("HTTP V5.16 Guarda: main.ts não injeta dependência; sem backend retorna 503",async()=>{
 await withServer(undefined,async root=>{
  const x=await request(root,path);
  assert.equal(x.status,503);
  assert.equal(x.body.error,"NOT_IMPLEMENTED");
 });
});
test("HTTP V5.16 Guarda: lista só com Bearer e município, método GET e sem tokens por URL",async()=>{
 let calls=0;
 await withServer({
  list:async(...args)=>{calls++;return backend.list(...args);},
  detail:backend.detail
 },async root=>{
  const success=await request(root,path+"?filter=NEW&limit=10");
  assert.equal(success.status,200);
  assert.equal(success.body.items[0].status,"RECEBIDA");
  assert.equal(success.body.filter,"NEW");
  assert.equal(success.body.limit,10);
  assert.equal(success.headers.get("cache-control"),"no-store");
  assert.equal(success.headers.get("access-control-allow-origin"),null);
  assert.equal(success.headers.get("x-content-type-options"),"nosniff");
  for(const p of [path+"?token=secret",path+"?filter=HACK",
      path+"?filter=ALL&filter=NEW",path+"?limit=500",
      path+"?after=DROP%20TABLE"]){
   const x=await request(root,p);
   assert.equal(x.status,400,p);
  }
  const missing=await fetch(root+path).then(async r=>({
   status:r.status,body:await r.json(),auth:r.headers.get("www-authenticate")
  }));
  assert.equal(missing.status,401);
  assert.equal(missing.auth,"Bearer");
  assert.equal(missing.body.error,"GUARD_SESSION_REQUIRED");
  const malformed=await request(root,path,{headers:{authorization:"Bearer fake"}});
  assert.equal(malformed.status,401);
  const unsupported=await request(root,path,{method:"POST"});
  assert.equal(unsupported.status,405);
  assert.equal(unsupported.headers.get("allow"),"GET");
  assert.equal(calls,1,"input inválido não chega ao banco");
 });
});
test("HTTP V5.16 Guarda: detalhe restrito, métodos, corpo proibido",async()=>{
 await withServer(backend,async root=>{
  const d=await request(root,path+"/"+protocol);
  assert.equal(d.status,200);
  assert.equal(d.body.reporter.name,"Pessoa sintética");
  const invalid=await request(root,path+"/not-a-protocol");
  assert.equal(invalid.status,400);
  for(const suffix of ["?token=secret","?other=1"]){
   const x=await request(root,path+"/"+protocol+suffix);
   assert.equal(x.status,400);
  }
  const post=await request(root,path+"/"+protocol,{method:"POST"});
  assert.equal(post.status,405);
  const body=await request(root,path,{headers:{"content-length":"0"}});
  assert.equal(body.status,400);
 });
});
test("HTTP V5.16 Guarda: erros de role do PostgreSQL não vaza SQL nem PII",async()=>{
 const secret="private-postgres-password";
 for(const [dbCode,status,name] of [
  ["JF003",403,"GUARD_ACCESS_DENIED"],
  ["JF004",404,"GUARD_PROTOCOL_NOT_FOUND"],
  ["JF001",400,"INVALID_GUARD_QUERY"],
  ["XX001",503,"GUARD_READ_UNAVAILABLE"]
 ]){
  await withServer({
   list:async()=>{const error=new Error(secret);error.code=dbCode;throw error;},
   detail:async()=>{throw Error("must not call detail");}
  },async root=>{
   const response=await request(root,path);
   assert.equal(response.status,status,dbCode);
   assert.equal(response.body.error,name);
   assert(!JSON.stringify(response.body).includes(secret));
  });
 }
});
test("HTTP V5.16 Guarda: até 8 leituras ativas; nona não acessa backend",async()=>{
 let arrived=0,release;
 const gate=new Promise(done=>release=done);
 const deps={
  list:async()=>{arrived++;await gate;return {items:[]};},
  detail:backend.detail
 };
 await withServer(deps,async root=>{
  const pending=Array.from({length:8},()=>request(root,path));
  // Aguarda as oito chamadas chegar via HTTP, sem temporizador global.
  for(let i=0;i<200&&arrived!==8;i++)
   await new Promise(ok=>setTimeout(ok,5));
  try{
   assert.equal(arrived,8);
   const ninth=await request(root,path);
   assert.equal(ninth.status,429);
   assert.equal(ninth.body.error,"GUARD_READ_BUSY");
   assert.equal(arrived,8);
  }finally{release();}
  for(const item of await Promise.all(pending))assert.equal(item.status,200);
 });
});
test("HTTP V5.16 Guarda: rota externa não ativa estado da denúncia",async()=>{
 await withServer(backend,async root=>{
  const x=await request(root,"/api/v1/guarda/assumir",{method:"POST"});
  assert.equal(x.status,503);
  assert.equal(x.body.error,"NOT_IMPLEMENTED");
  const unknown=await request(root,"/api/v1/guarda/transitoX");
  assert.equal(unknown.status,503);
 });
});
