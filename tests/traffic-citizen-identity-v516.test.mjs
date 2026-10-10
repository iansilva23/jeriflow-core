import test from "node:test";
import assert from "node:assert/strict";
import {resolveTrafficCitizenIdentityV516 as resolve} from "../apps/api/src/traffic-citizen-identity-v516.ts";

const municipality="municipio-exemplo-sem-dados-reais";
const guest={name:"Pessoa Exemplo",birthDate:"2000-01-01",phone:"00000000000"};
const account={municipalityId:municipality,citizenId:"CID-00000001",name:"Pessoa Registrada",birthDate:"2001-01-01",phone:"11111111111",address:"Exemplo",login:"conta.exemplo",active:true,blocked:false};
const verified=async token=>token==="token-autenticado-de-teste"?account:null;
const error=code=>e=>e?.code===code;

test("V5.16: visitante identificado com nome, nascimento, telefone e sem conta",async()=>{
 const value=await resolve({municipalityId:municipality,guest},()=>{throw Error("não deve consultar login")});
 assert.deepEqual(value,{registered:false,citizenId:"",name:guest.name,birthDate:guest.birthDate,phone:guest.phone,address:"",login:""});
 assert(Object.isFrozen(value));
});
test("V5.16: visitante pode fornecer campos com espaços, que são normalizados",async()=>{
 const result=await resolve({municipalityId:municipality,guest:{name:"  Nome  ",birthDate:" 2000-01-01 ",phone:" 123 "}},verified);
 assert.deepEqual([result.name,result.birthDate,result.phone],["Nome","2000-01-01","123"]);
});
test("V5.16: identificação do visitante requer exatamente os três campos originais",async()=>{
 for(const key of ["name","birthDate","phone"]){
  await assert.rejects(resolve({municipalityId:municipality,guest:{...guest,[key]:"  "}},verified),error("CITIZEN_IDENTITY_REQUIRED"));
 }
});
test("V5.16: autenticado usa os dados autoritativos, não identidade injetada de cliente",async()=>{
 const result=await resolve({municipalityId:municipality,sessionToken:"token-autenticado-de-teste",guest},verified);
 assert.deepEqual(result,{registered:true,citizenId:account.citizenId,name:account.name,birthDate:account.birthDate,phone:account.phone,address:account.address,login:account.login});
});
test("V5.16: sessão falsificada não passa, mesmo fornecendo identificação de visitante",async()=>{
 await assert.rejects(resolve({municipalityId:municipality,sessionToken:"token-falso",guest},verified),error("CITIZEN_SESSION_INVALID"));
 await assert.rejects(resolve({municipalityId:municipality,sessionToken:"",guest},verified),error("CITIZEN_SESSION_INVALID"));
});
test("V5.16: conta bloqueada não pode apresentar denúncia",async()=>{
 await assert.rejects(resolve({municipalityId:municipality,sessionToken:"t"},async()=>({...account,blocked:true})),error("CITIZEN_SUBMISSION_BLOCKED"));
});
test("V5.16: conta desativada não pode ser usada no lugar de visitante",async()=>{
 await assert.rejects(resolve({municipalityId:municipality,sessionToken:"t",guest},async()=>({...account,active:false})),error("CITIZEN_SESSION_INVALID"));
});
test("V5.16: sessão válida em outro município não autoriza envio neste município",async()=>{
 await assert.rejects(resolve({municipalityId:municipality,sessionToken:"t"},async()=>({...account,municipalityId:"outro-municipio"})),error("CITIZEN_SESSION_INVALID"));
});
test("V5.16: falha do provedor não permite tratar cadastrado como visitante",async()=>{
 await assert.rejects(resolve({municipalityId:municipality,sessionToken:"t",guest},async()=>{throw new Error("db unavailable")}),error("CITIZEN_IDENTITY_UNAVAILABLE"));
});
test("V5.16: falta município rejeita identidade antes de consultar sessão",async()=>{
 await assert.rejects(resolve({municipalityId:"  ",guest},verified),error("CITIZEN_IDENTITY_UNAVAILABLE"));
});
test("V5.16: visitante não pode preencher citizenId ou login por campos extras",async()=>{
 const impostor={...guest,citizenId:account.citizenId,login:account.login,registered:true};
 const result=await resolve({municipalityId:municipality,guest:impostor},verified);
 assert.deepEqual(Object.keys(result),["registered","citizenId","name","birthDate","phone","address","login"]);
 assert.equal(result.registered,false);
 assert.equal(result.citizenId,"");
 assert.equal(result.login,"");
});
