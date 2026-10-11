import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {bearerTransport} from "../packages/auth/client.ts";
const token=randomBytes(32).toString("base64url");
const mid="733c6075-bd63-48f8-b2a9-f21250e238df";
test("V5.16 bridge Guarda usa token do mesmo vault e não o expõe",async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,init)=>{
  calls++;assert.equal(url,"https://api.example.test/api/v1/guarda/transito?filter=ALL");
  assert.equal(init.headers.Authorization,"Bearer "+token);
  assert.equal(init.headers["X-JeriFlow-Municipality-Id"],mid);
  return new Response(JSON.stringify({items:[]}),{status:200});
 };
 try{
  const auth=bearerTransport(()=> "https://api.example.test",{
   get:async()=>token,set:async()=>{},remove:async()=>{}
  });
  assert.equal(typeof auth.guardRequest,"function");
  assert.equal(Object.prototype.hasOwnProperty.call(auth,"token"),false);
  assert.deepEqual(await auth.guardRequest(mid,"/api/v1/guarda/transito?filter=ALL","GET"),{items:[]});
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test("V5.16 bridge Guarda rejeita caminhos indevidos antes de ler o token",async()=>{
 let reads=0;
 const auth=bearerTransport(()=> "https://api.example.test",{
  get:async()=>{reads++;return token;},set:async()=>{},remove:async()=>{}
 });
 for(const path of [
  "/api/v1/guarda/transito?token=x",
  "/api/v1/guarda/transito?limit=500",
  "/api/v1/guarda/transito/JF-20261011-0000001",
  "/api/v1/guarda/transito?after=JF-20261011-0000001"
 ])await assert.rejects(auth.guardRequest(mid,path,"GET"),e=>e.code==="INVALID_INPUT");
 await assert.rejects(auth.guardRequest(mid,"/api/v1/guarda/transito/JF-20261011-000001/atender","GET"),e=>e.code==="INVALID_INPUT");
 await assert.rejects(auth.guardRequest(mid,"/api/v1/guarda/transito","POST",{requestId:"x"}),e=>e.code==="INVALID_INPUT");
 assert.equal(reads,0);
});
