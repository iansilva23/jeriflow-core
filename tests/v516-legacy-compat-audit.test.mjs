import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {auditLegacyMigrations} from "../scripts/v516-legacy-compat-audit.mjs";

async function fixtures(){
 const root=await mkdtemp(join(tmpdir(),"jf516-legacy-guard-"));
 const current=join(root,"current"),legacy=join(root,"legacy");
 await Promise.all([current,legacy].map(p=>
   mkdir(join(p,"infra","migrations"),{recursive:true})));
 const write=async(dir,name,sql)=>writeFile(join(dir,"infra","migrations",name),sql);
 for(const id of ["001","002","003"]){
   const name=id+"-identity.sql",sql="-- Shared identity V5.16 "+id+"\n";
   await write(current,name,sql);await write(legacy,name,sql);
 }
 for(let n=4;n<=17;n++){
   const ordinal=String(n).padStart(3,"0");
   let name=ordinal+"-legacy.sql";
   let sql="-- Legacy "+ordinal+"\nCREATE TABLE app.legacy_t"+ordinal+"(id integer);\n";
   if(n===12){name="012-guarda-occurrences.sql";sql="CREATE TABLE app.guarda_occurrences(id uuid);\n";}
   if(n===17){name="017-parking-service-requests.sql";sql="CREATE TABLE app.parking_service_requests(id uuid);\n";}
   await write(legacy,name,sql);
   if(n<=10)await write(current,ordinal+"-new.sql",
      "-- Current V5.16 "+ordinal+"\nCREATE TABLE app.current_t"+ordinal+"(id integer);\n");
 }
 await write(current,"020-parking-v516-register-extensions-exit.sql",
   "CREATE TABLE app.parking_v516_registrations(id uuid);\n");
 await write(current,"021-parking-v516-admin-queries.sql",
   "CREATE FUNCTION app.parking_v516_admin_list() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;\n");
 await write(current,"022-parking-v516-access-tokens.sql",
   "CREATE TABLE app.parking_v516_access_keys(id uuid);\n");
 return {root,current,legacy,write};
}
test("V5.16: auditoria é só leitura e distingue identidade compartilhada de 7 colisões",async()=>{
 const f=await fixtures();
 try{
  const report=auditLegacyMigrations(f.current,f.legacy);
  assert.equal(report.mode,"READ_ONLY_NO_MERGE");
  assert.equal(report.sharedIdentityUnchanged,3);
  assert.deepEqual(report.ordinalCollisions,
    ["004","005","006","007","008","009","010"]);
  assert.deepEqual(report.legacyOnly,
    ["011","012","013","014","015","016","017"]);
  assert.deepEqual(report.currentOnly,["020","021","022"]);
  assert.equal(report.matrix.find(x=>x.ordinal==="017").classification,"LEGACY_ONLY");
  assert.equal(report.matrix.find(x=>x.ordinal==="020").classification,"CURRENT_ONLY");
  assert(report.warnings.some(x=>x.includes("NOT the V5.16 payment")));
  assert.equal(report.matrix.length,20);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test("V5.16: alteração de uma migração 001–003 bloqueia integração automática",async()=>{
 const f=await fixtures();
 try{
  await f.write(f.legacy,"002-identity.sql","-- APAGOU A IDENTIDADE PROTEGIDA\n");
  assert.throws(()=>auditLegacyMigrations(f.current,f.legacy),
    /identity migration 002 drifted/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test("V5.16: colisão nova 011 também exige reauditoria, nunca resolve silenciosamente",async()=>{
 const f=await fixtures();
 try{
  await f.write(f.current,"011-unexpected.sql","CREATE TABLE app.unknown_new(id integer);");
  assert.throws(()=>auditLegacyMigrations(f.current,f.legacy),
    /migration collision topology CHANGED/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test("V5.16: nome 017 alterado ou substituição da fila antiga é bloqueado",async()=>{
 const f=await fixtures();
 try{
  await f.write(f.legacy,"017-parking-service-requests.sql",
    "CREATE TABLE app.parking_v516_registrations(id uuid);\n");
  assert.throws(()=>auditLegacyMigrations(f.current,f.legacy),
    /old request queue unexpectedly changed/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test("V5.16: dois scripts com número igual numa branch não são aceitos",async()=>{
 const f=await fixtures();
 try{
  await f.write(f.current,"020-another-script.sql",
    "CREATE TABLE app.evil_new(id integer);");
  assert.throws(()=>auditLegacyMigrations(f.current,f.legacy),
    /DUPLICATED_ORDINAL_WITHIN_BRANCH/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
