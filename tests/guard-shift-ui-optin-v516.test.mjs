import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {bearerTransport} from "../packages/auth/client.ts";
const mid="733c6075-bd63-48f8-b2a9-f21250e238df";
const id="94521636-4b86-46d1-8c5e-3644b1e15b51";
test("plantão utiliza token privado da sessão e não muda trajeto original",async()=>{
 const calls=[];
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return {ok:true,status:200,json:async()=>({onShift:opts.method==="GET",updatedAt:null})};};
 try{
  const t=bearerTransport(()=>"https://example.invalid",{get:async()=>"A".repeat(43),set:async()=>{},remove:async()=>{}});
  assert.equal((await t.shiftRequest(mid,"GET")).onShift,true);
  assert.equal((await t.shiftRequest(mid,"POST",{requestId:id,onShift:false})).onShift,false);
  assert.equal(calls.length,2);
  assert.equal(calls[1].opts.headers.Authorization,"Bearer "+"A".repeat(43));
  assert.equal(calls[1].opts.headers["X-JeriFlow-Municipality-Id"],mid);
  assert.equal(calls[1].url,"https://example.invalid/api/v1/guarda/plantao");
 }finally{globalThis.fetch=originalFetch;}
});
test("tela de plantão permanece dentro da autorização e não bloqueia atendimento",()=>{
 const screen=readFileSync(new URL("../apps/guarda/GuardQueueScreenV516.tsx",import.meta.url),"utf8");
 const view=readFileSync(new URL("../apps/guarda/GuardAuthorizedViewV516.tsx",import.meta.url),"utf8");
 const app=readFileSync(new URL("../apps/guarda/App.tsx",import.meta.url),"utf8");
 assert.match(view,/if\(authorized&&grant\)return <GuardQueueScreenV516/);
 assert.match(screen,/EM SERVIÇO/);
 assert.match(screen,/FORA DE SERVIÇO/);
 assert.match(screen,/actions\.accept\(id\)/);
 assert.match(screen,/actions\.finish\(id,data\)/);
 assert.match(app,/EXPO_PUBLIC_GUARDA_V516_PREVIEW === "1"/);
});
