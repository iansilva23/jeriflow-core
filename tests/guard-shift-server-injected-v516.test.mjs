import test from "node:test";
import assert from "node:assert/strict";
import {createApp} from "../apps/api/src/server.ts";
const path="/api/v1/guarda/plantao";
const mid="733c6075-bd63-48f8-b2a9-f21250e238df";
const requestId="94521636-4b86-46d1-8c5e-3644b1e15b51";
const headers={Authorization:"Bearer "+"A".repeat(43),"X-JeriFlow-Municipality-Id":mid};

async function serve(shift,run){
 const app=createApp(undefined,undefined,undefined,undefined,undefined,shift);
 await new Promise((resolve,reject)=>{app.once("error",reject);app.listen(0,"127.0.0.1",resolve);});
 try{
  const addr=app.address();assert(addr&&typeof addr!=="string");
  await run("http://127.0.0.1:"+addr.port);
 }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
}
test("sem injeção, plantão permanece não implementado (main protegido)",async()=>{
 await serve(undefined,async base=>{
  const response=await fetch(base+path,{headers});
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,"NOT_IMPLEMENTED");
 });
});
test("GET/POST plantão injetado usa token e município e devolve estado canônico",async()=>{
 const events=[];
 const service={
  get:async actor=>{events.push(["get",actor]);return {onShift:true,updatedAt:null};},
  set:async(actor,id,onShift)=>{events.push(["set",actor,id,onShift]);return {onShift,updatedAt:null,alreadyProcessed:false};}
 };
 await serve(service,async base=>{
  const read=await fetch(base+path,{headers});
  assert.equal(read.status,200);
  assert.equal((await read.json()).onShift,true);
  const update=await fetch(base+path,{method:"POST",headers:{...headers,"Content-Type":"application/json"},
    body:JSON.stringify({requestId,onShift:false})});
  assert.equal(update.status,200);
  assert.equal((await update.json()).onShift,false);
  assert.deepEqual(events.map(e=>e[0]),["get","set"]);
  assert.equal(events[1][2],requestId);
  assert.equal(events[1][3],false);
  assert.equal(events[0][1].municipalityId,mid);
 });
});
test("método, sessão e papel negado permanecem bloqueados na fronteira HTTP",async()=>{
 let calls=0;
 const service={get:async()=>{calls++;const e=new Error("forbidden");e.code="JF003";throw e;},
  set:async()=>{calls++;throw new Error("should not reach");}};
 await serve(service,async base=>{
  const method=await fetch(base+path,{method:"PUT",headers});
  assert.equal(method.status,405);
  const missing=await fetch(base+path);
  assert.equal(missing.status,401);
  const forbidden=await fetch(base+path,{headers});
  assert.equal(forbidden.status,403);
  assert.equal((await forbidden.json()).error,"GUARD_SHIFT_FORBIDDEN");
  assert.equal(calls,1);
 });
});
