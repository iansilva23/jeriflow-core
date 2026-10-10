import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {TrafficRegisteredFormServiceV516} from "../apps/api/src/traffic-form-submit-v516.ts";

const mid="e39a7fbe-5073-4cd9-ab08-e133414c7a68";
const token=randomBytes(32).toString("base64url");
const image=new Uint8Array([137,80,78,71,13,10,26,10]);
const original={
 municipalityId:mid,sessionToken:token,title:"Estacionamento irregular",
 location:"Vila de Jericoacoara",plate:"",description:"Denúncia teste",
 photoBytes:image,photoMime:"image/png"
};
async function withService(resolveSession,fn){
 let called=0;
 const service=new TrafficRegisteredFormServiceV516({
  appDatabaseUrl:"postgresql://unused:unused@127.0.0.1:5432/offline",
  resolveSession,
  pipeline:{receiveRegistered:async()=>{called++;throw Error("MUST_NOT_REACH_STORAGE");}}
 });
 try{await fn(service,()=>called);}
 finally{await service.close();}
}
test("V5.16: exatamente sete categorias originais são aceitas no validador interno",async()=>{
 const titles=[
 "Estacionamento irregular","Veículo bloqueando acesso/garagem",
 "Veículo em área proibida","Via parcialmente bloqueada",
 "Circulação irregular","Transporte irregular","Outro problema de trânsito"
 ];
 await withService(async()=>null,async(s,called)=>{
  for(const title of titles){
   await assert.rejects(s.submitRegistered({...original,title}),
    e=>e?.code==="TRAFFIC_SESSION_DENIED");
  }
  assert.equal(called(),0);
 });
});
test("V5.16: campos inválidos são bloqueados ANTES da identidade, foto e banco",async()=>{
 await withService(async()=>{throw Error("MUST_NOT_RESOLVE");},async(s,called)=>{
  const variants=[
   {title:"Cobrança de taxa nova"},{title:""},
   {location:""},{location:"    "},{description:""},
   {plate:"123456789"},{plate:"ABC\nDEF"},
   {municipalityId:"cross-tenant"},{sessionToken:"malformed"},
  ];
  for(const variant of variants){
   await assert.rejects(s.submitRegistered({...original,...variant}),
    e=>e?.code==="INVALID_TRAFFIC_FORM");
  }
  assert.equal(called(),0);
 });
});
test("V5.16: ausência de sessão válida não cria foto nem protocolo",async()=>{
 await withService(async()=>null,async(s,called)=>{
  await assert.rejects(s.submitRegistered(original),
   e=>e?.code==="TRAFFIC_SESSION_DENIED");
  assert.equal(called(),0);
 });
});
test("V5.16: conta bloqueada falha antes do scan",async()=>{
 await withService(async()=>({
  municipalityId:mid,citizenId:"CID-00012345",name:"Conta Teste",
  birthDate:"2000-01-01",phone:"000",address:"",login:"conta",
  active:true,blocked:true
 }),async(s,called)=>{
  await assert.rejects(s.submitRegistered(original),
   e=>e?.code==="TRAFFIC_SESSION_DENIED");
  assert.equal(called(),0);
 });
});
