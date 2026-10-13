import test from "node:test";
import assert from "node:assert/strict";
import {guardShiftMobileClientV516} from "../apps/guarda/guard-shift-mobile-client-v516.ts";
const mid="733c6075-bd63-48f8-b2a9-f21250e238df";
const id="94521636-4b86-46d1-8c5e-3644b1e15b51";
const token="A".repeat(43);
test("GET e POST preservam sessão, município e valor explícito",async()=>{
 const calls=[];
 const c=guardShiftMobileClientV516({endpoint:"https://example.invalid",municipalityId:mid,readToken:async()=>token,
 request:async(url,opt)=>{calls.push({url,opt});return {ok:true,status:200,json:async()=>({onShift:opt.method==="GET",updatedAt:null})};}});
 assert.equal((await c.get()).onShift,true);
 assert.equal((await c.set(id,false)).onShift,false);
 assert.equal(calls.length,2);
 assert.equal(calls[1].opt.headers["X-JeriFlow-Municipality-Id"],mid);
 assert.equal(calls[1].opt.headers.Authorization,"Bearer "+token);
 assert.deepEqual(JSON.parse(calls[1].opt.body),{requestId:id,onShift:false});
});
test("sessão ausente e UUID inválido falham antes da rede",async()=>{
 let calls=0;
 const c=guardShiftMobileClientV516({endpoint:"https://example.invalid",municipalityId:mid,readToken:async()=>null,
 request:async()=>{calls++;throw Error("network used");}});
 await assert.rejects(c.get(),e=>e.status===401);
 await assert.rejects(c.set("invalid",false),/INVALID_INPUT/);
 assert.equal(calls,0);
});
test("403, erro de rede e formato inválido nunca são sucesso",async()=>{
 const cfg={endpoint:"https://example.invalid",municipalityId:mid,readToken:async()=>token};
 await assert.rejects(guardShiftMobileClientV516({...cfg,request:async()=>({ok:false,status:403,json:async()=>({error:"GUARD_SHIFT_FORBIDDEN"})})}).get(),e=>e.status===403);
 await assert.rejects(guardShiftMobileClientV516({...cfg,request:async()=>{throw Error("offline");}}).get(),/NETWORK/);
 await assert.rejects(guardShiftMobileClientV516({...cfg,request:async()=>({ok:true,status:200,json:async()=>({onShift:"false",updatedAt:null})})}).get(),/INVALID_RESPONSE/);
});
