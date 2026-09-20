import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { managementMutation, managementQuery, publicProfile } from "../apps/api/src/account-input.ts";
import { AuthController } from "../packages/auth/controller.ts";
import { AuthFailure } from "../packages/auth/client.ts";
const id=randomUUID(), credentials={password:"Senha ficticia longa 123!",code:"123456"};
test("cadastro público não aceita perfis internos, Mestre, privilégios extras ou município inválido",()=>{
  for(const role of ["guarda","fiscal-tts","admin-tts","mestre","platform_admin",null]) assert.throws(()=>publicProfile({municipalityId:id,role}));
  assert.deepEqual(publicProfile({municipalityId:id,role:"cidadao"}),{municipalityId:id,role:"cidadao"});
  assert.throws(()=>publicProfile({municipalityId:id,role:"turista",platformAdmin:true}));
  assert.throws(()=>publicProfile({municipalityId:"bad",role:"turista"}));
});
test("gestão valida operação exata, revisão, fator e conjunto conhecido de perfis",()=>{
  const input={...credentials,operation:"set-membership",userId:id,municipalityId:id,revision:1,roles:["guarda","cidadao"]};
  const parsed=managementMutation(input); assert.deepEqual(parsed.data.roles,["cidadao","guarda"]);
  assert.equal(parsed.data.password,undefined);assert.equal(parsed.data.code,undefined);
  for(const change of [{roles:["mestre"]},{roles:["cidadao","cidadao"]},{revision:0},{revision:"1"},{revision:null},{code:"bad"},{userId:undefined},{active:true},{platformAdmin:true}]) assert.throws(()=>managementMutation({...input,...change}));
  assert.deepEqual(managementMutation({...input,roles:[]}).data.roles,[]);
  assert.throws(()=>managementMutation({...credentials,operation:"invite",email:"a@example.invalid",municipalityId:id,roles:[]}));
  assert.throws(()=>managementMutation({...credentials,operation:"set-active",userId:id,revision:1,active:"false"}));
  assert.throws(()=>managementMutation({...credentials,operation:"delete",userId:id,revision:1}));
});
test("gestão pagina com UUID, recusa filtros indevidos e valida identificador de município",()=>{
  assert.deepEqual(managementQuery({kind:"accounts",after:id}),{kind:"accounts",after:id,municipalityId:null});
  for(const input of [{kind:"unknown"},{kind:"accounts",after:"bad"},{kind:"municipalities",municipalityId:id},{kind:"accounts",limit:100000}]) assert.throws(()=>managementQuery(input));
  assert.equal(managementMutation({...credentials,operation:"create-municipality",slug:"cidade-teste",displayName:" Cidade "}).data.displayName,"Cidade");
  for(const slug of ["a","Cidade","-cidade","cidade-","cidade com espaco"]) assert.throws(()=>managementMutation({...credentials,operation:"create-municipality",slug,displayName:"Cidade"}));
});
test("controlador cadastra sem senha antes do email e não conclui confirmação divergente",async()=>{
  const calls=[],transport={clear:async()=>{},request:async(path,body)=>{calls.push({path,body});return{accepted:true};}};
  const c=new AuthController(transport);c.navigate("register");await c.register("public@example.invalid");
  assert.equal(c.snapshot().mode,"activate");assert.deepEqual(calls[0].body,{email:"public@example.invalid"});
  await c.activate("code","Nome",credentials.password,"outra");assert.equal(calls.length,1);assert(c.snapshot().error);
  await c.activate(" code ","Nome",credentials.password,credentials.password);assert.equal(c.snapshot().mode,"login");assert.equal(calls[1].body.token,"code");
  assert(!JSON.stringify(c.snapshot()).includes(credentials.password));
});
test("diretório é paginado, deduplica resultados e não declara vínculo se servidor recusou",async()=>{
  let page=0;
  const c=new AuthController({clear:async()=>{},request:async(path)=>{
    if(path==="/auth/municipalities")return{items:[{id,displayName:"Cidade"}],next:page++ ? null : id};
    throw new AuthFailure("MEMBERSHIP_SUSPENDED",403);
  }});
  await c.loadMunicipalities();await c.loadMunicipalities(true);assert.equal(c.snapshot().municipalities.length,1);assert.equal(c.snapshot().nextMunicipality,null);
  await c.join(id,"cidadao");assert.equal(c.snapshot().mode,"join");assert(c.snapshot().error);assert.equal(c.snapshot().notice,undefined);
});
