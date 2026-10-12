import test from "node:test";
import assert from "node:assert/strict";
import {guardEligibleMunicipalitiesV516,guardAuthorizedActionsV516} from "../apps/guarda/guard-access-gate-v516.ts";
const mid="733c6075-bd63-48f8-b2a9-f21250e238df";
const context=(step="ready",permissions=["mobile:guarda:access"])=>({
 user:{id:mid,email:"test@example.invalid",displayName:"Teste"},
 municipalities:[{id:mid,displayName:"Município de teste",roles:["guarda"],permissions}],
 platformPermissions:[],security:{emailVerified:true,mfaEnabled:true,mfaRequired:true,nextStep:step}
});
test("Gate Guarda impede privilégios ausentes, MFA pendente e município estranho",async()=>{
 let calls=0;const transport={clear:async()=>{},request:async()=>{calls++;return {};}};
 assert.deepEqual(guardEligibleMunicipalitiesV516(context("mfa_challenge")),[]);
 assert.deepEqual(guardEligibleMunicipalitiesV516(context("ready",[])),[]);
 await assert.rejects(guardAuthorizedActionsV516(transport,context("ready",[]),mid,()=>mid),e=>e.code==="FORBIDDEN");
 await assert.rejects(guardAuthorizedActionsV516(transport,context(),"733c6075-bd63-48f8-b2a9-f21250e238de",()=>mid),e=>e.code==="FORBIDDEN");
 assert.equal(calls,0);
});
test("Gate Guarda confirma /access no servidor antes de liberar operações",async()=>{
 let checked=0;
 const transport={clear:async()=>{},request:async path=>{
  checked++;assert(path.includes("permission=mobile%3Aguarda%3Aaccess"));return {allowed:true,municipalityId:mid,permission:"mobile:guarda:access"};
 },guardRequest:async()=>({items:[]})};
 const operations=await guardAuthorizedActionsV516(transport,context(),mid,()=>mid);
 assert.equal(checked,1);
 assert.deepEqual(await operations.load("NEW"),[]);
});
test("Gate Guarda não permite ações após recusa de acesso remoto",async()=>{
 const transport={clear:async()=>{},request:async()=>{throw Error("DENIED");},guardRequest:async()=>{throw Error("MUST_NOT_RUN");}};
 await assert.rejects(guardAuthorizedActionsV516(transport,context(),mid,()=>mid),/DENIED/);
});

test("Gate Guarda rejeita HTTP 200 sem concessão explícita e exata",async()=>{
 const rejected=[
  {},{authorized:true},{allowed:true},
  {allowed:false,municipalityId:mid,permission:"mobile:guarda:access"},
  {allowed:true,municipalityId:mid,permission:"mobile:guarda:read"},
  {allowed:true,municipalityId:"733c6075-bd63-48f8-b2a9-f21250e238de",permission:"mobile:guarda:access"},
 ];
 for(const reply of rejected){
  let attempts=0;
  const transport={clear:async()=>{},request:async()=>reply,
   guardRequest:async()=>{attempts++;throw Error("UNAUTHORIZED_REQUEST");}};
  await assert.rejects(
   guardAuthorizedActionsV516(transport,context(),mid,()=>mid),
   error=>error.code==="FORBIDDEN"&&error.status===403
  );
  assert.equal(attempts,0);
 }
});
