import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GUARD_SHIFT_PATH_V516,handleGuardShiftHttpV516,mapGuardShiftHttpErrorV516} from "../apps/api/src/guard-shift-http-v516.ts";
const token="A".repeat(43),mid="733c6075-bd63-48f8-b2a9-f21250e238df",id="94521636-4b86-46d1-8c5e-3644b1e15b51";
function req(method,body,headers={}){
 const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
 return {method,headers:{authorization:"Bearer "+token,"x-jeriflow-municipality-id":mid,
  ...(bytes?{"content-type":"application/json","content-length":String(bytes.length)}:{}),...headers},
  async *[Symbol.asyncIterator](){if(bytes)yield bytes;}}
}
test("plantão consulta e altera valor desejado, sem alternância implícita",async()=>{
 const calls=[];
 const service={get:async actor=>{calls.push(["get",actor]);return {onShift:true,updatedAt:null};},
  set:async(actor,requestId,onShift)=>{calls.push(["set",actor,requestId,onShift]);return {onShift,updatedAt:null,alreadyProcessed:false};}};
 assert.deepEqual(await handleGuardShiftHttpV516(req("GET"),GUARD_SHIFT_PATH_V516,service),{onShift:true,updatedAt:null});
 assert.equal((await handleGuardShiftHttpV516(req("POST",{requestId:id,onShift:false}),GUARD_SHIFT_PATH_V516,service)).onShift,false);
 assert.deepEqual(calls.map(c=>c[0]),["get","set"]);
 assert.equal(calls[1][2],id);assert.equal(calls[1][3],false);
 assert.equal(calls[0][1].municipalityId,mid);
});
test("operação não aceita conteúdo extra, identificação ausente ou método desconhecido",async()=>{
 const service={get:async()=>{throw Error("UNREACHABLE");},set:async()=>{throw Error("UNREACHABLE");}};
 for(const value of [{requestId:id,onShift:true,extra:"x"},{requestId:id,onShift:"true"},{requestId:"bad",onShift:true}])
  await assert.rejects(handleGuardShiftHttpV516(req("POST",value),GUARD_SHIFT_PATH_V516,service),e=>e.status===400);
 await assert.rejects(handleGuardShiftHttpV516(req("PUT"),GUARD_SHIFT_PATH_V516,service),e=>e.status===405);
 await assert.rejects(handleGuardShiftHttpV516(req("GET",undefined,{authorization:"invalid"}),GUARD_SHIFT_PATH_V516,service),e=>e.status===401);
});
test("erros de permissão, conflito e indisponibilidade não revelam conteúdo sensível",()=>{
 assert.equal(mapGuardShiftHttpErrorV516({code:"JF003"}).status,403);
 assert.equal(mapGuardShiftHttpErrorV516({code:"JF005"}).status,409);
 assert.equal(mapGuardShiftHttpErrorV516(new Error("secret")).code,"GUARD_SHIFT_UNAVAILABLE");
});
test("contrato continua não exposto em main.ts e não substitui as rotas atuais",()=>{
 const main=readFileSync(new URL("../apps/api/src/main.ts",import.meta.url),"utf8");
 const server=readFileSync(new URL("../apps/api/src/server.ts",import.meta.url),"utf8");
 assert.doesNotMatch(main,/guard-shift-http-v516/);
 assert.match(server,/if \(!guardShift\) \{send\(503,\{error:"NOT_IMPLEMENTED",requestId\}\);return;\}/);
 assert.match(server,/guardShift\?: GuardShiftHttpDependenciesV516/);
});
