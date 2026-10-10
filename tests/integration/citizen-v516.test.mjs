import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import pg from "pg";
import {randomUUID,createHash} from "node:crypto";
import {CitizenAccountsV516,normalizeCitizenLoginV516,verifyCitizenPasswordV516} from "../../apps/api/src/citizen-accounts-v516.ts";
import {resolveTrafficCitizenIdentityV516} from "../../apps/api/src/traffic-citizen-identity-v516.ts";

// Integration is intentionally ONLY against disposable PostgreSQL from GitHub Actions.
const ownerDsn=process.env.JF_V516_TEST_OWNER_DSN;
const appDsn=process.env.JF_V516_TEST_APP_DSN;
if(!ownerDsn||!appDsn)throw new Error("DEDICATED_TEST_DATABASE_REQUIRED");
const owner=new pg.Client({connectionString:ownerDsn});
const restricted=new pg.Client({connectionString:appDsn});
const auth=new CitizenAccountsV516(appDsn);
const name="Morador Fictício",password="s3nh@123",birthDate="2001-08-09";
const form=(mid,login,phone="(88) 90000-0000")=>({
 municipalityId:mid,name,birthDate,phone,address:"Referência fictícia na Vila",
 login,password,confirmPassword:password
});
const code=(v)=>e=>e?.code===v;

test("V5.16: banco PostgreSQL real, cadastro imediato sem email e sessão segura", {timeout:120_000},async t=>{
 await owner.connect();
 try{
  // These setup commands are limited to an empty ephemeral CI database.
  await owner.query("CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-jeriflow-test-only'");
  await owner.query("CREATE SCHEMA app");
  await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
  for(const file of ["001-identity.sql","002-identity-security.sql","003-account-management.sql","004-citizen-v516.sql"]){
   await owner.query(readFileSync(new URL("../../infra/migrations/"+file,import.meta.url),"utf8"));
  }
  await restricted.connect();
  const midA=randomUUID(),midB=randomUUID();
  await owner.query("INSERT INTO app.municipalities(id,slug,display_name) VALUES ($1,'cidade-teste-a','Município A fictício'),($2,'cidade-teste-b','Município B fictício')",[midA,midB]);
  let tokenA,citizenId;

  await t.test("normalização idêntica a citizenNorm() no HTML",()=>{
   assert.equal(normalizeCitizenLoginV516("  João da  Silva  "),"joao.da.silva");
   assert.equal(normalizeCitizenLoginV516("MA-RIA__Oliveira"),"ma-ria__oliveira");
  });
  await t.test("cadastro imediato usa nome, nascimento, telefone, referência, login e senha de 8",async()=>{
   const result=await auth.signup(form(midA,"  João da Silva "));
   tokenA=result.accessToken;citizenId=result.citizenId;
   assert.match(result.citizenId,/^CID-\d{8,}$/);
   assert.match(tokenA,/^[A-Za-z0-9_-]{43}$/);
   const a=await owner.query("SELECT citizen_id,name,birth_date,phone,address,login,password_hash FROM app.citizen_v516_accounts WHERE citizen_id=$1",[citizenId]);
   assert.equal(a.rowCount,1);assert.equal(a.rows[0].login,"joao.da.silva");
   assert.equal(a.rows[0].name,name);assert.equal(a.rows[0].birth_date.toISOString().slice(0,10),birthDate);
   assert.equal(await verifyCitizenPasswordV516(password,a.rows[0].password_hash),true);
   assert(!a.rows[0].password_hash.includes(password));
   const sessions=await owner.query("SELECT token_hash FROM app.citizen_v516_sessions WHERE account_id=(SELECT id FROM app.citizen_v516_accounts WHERE citizen_id=$1)",[citizenId]);
   assert.equal(sessions.rows[0].token_hash,createHash("sha256").update(tokenA).digest("hex"));
   assert(!JSON.stringify(sessions.rows).includes(tokenA));
  });
  await t.test("não solicita e-mail nem modifica identidade genérica",async()=>{
   assert.equal((await owner.query("SELECT count(*)::int AS n FROM app.identity_users")).rows[0].n,0);
   assert.equal((await auth.resolveSession(tokenA,midA))?.citizenId,citizenId);
  });
  await t.test("não permite duplicar login do mesmo município",async()=>{
   await assert.rejects(auth.signup(form(midA,"João da Silva","(88) 90000-0001")),code("CITIZEN_LOGIN_IN_USE"));
  });
  await t.test("senha incorreta não autentica e login válido usa senha original de 8",async()=>{
   await assert.rejects(auth.login({municipalityId:midA,login:"joao.da.silva",password:"senhaerrada"}),code("CITIZEN_LOGIN_INVALID"));
   await assert.rejects(auth.login({municipalityId:midA,login:"inexistente",password:"senhaerrada"}),code("CITIZEN_LOGIN_INVALID"));
   const logged=await auth.login({municipalityId:midA,login:"João da Silva",password});
   assert.notEqual(logged.accessToken,tokenA);
   assert.equal((await auth.resolveSession(logged.accessToken,midA))?.citizenId,citizenId);
  });
  await t.test("sessão do mesmo cidadão não ultrapassa município",async()=>{
   assert.equal(await auth.resolveSession(tokenA,midB),null);
   const elsewhere=await auth.signup(form(midB,"João da Silva","(88) 90000-0002"));
   assert.notEqual(elsewhere.citizenId,citizenId);
   assert.equal(await auth.resolveSession(elsewhere.accessToken,midA),null);
  });
  await t.test("resolvedor real preenche identidade sem confiar em JSON do app",async()=>{
   const identity=await resolveTrafficCitizenIdentityV516(
      {municipalityId:midA,sessionToken:tokenA,guest:{name:"Ataque",birthDate:"1900-01-01",phone:"0"}},
      auth.resolveSession.bind(auth));
   assert.equal(identity.registered,true);
   assert.equal(identity.citizenId,citizenId);
   assert.equal(identity.name,name);
   assert.equal(identity.login,"joao.da.silva");
  });
  await t.test("role da API não lê nem altera registros civis/senhas/sessões",async()=>{
   await assert.rejects(restricted.query("SELECT * FROM app.citizen_v516_accounts"),e=>e.code==="42501");
   await assert.rejects(restricted.query("SELECT * FROM app.citizen_v516_sessions"),e=>e.code==="42501");
   await assert.rejects(restricted.query("UPDATE app.citizen_v516_accounts SET active=true"),e=>e.code==="42501");
  });
  await t.test("bloqueio administrativo V5.16 impede denúncia, login e novo cadastro com mesmo telefone",async()=>{
   await owner.query("UPDATE app.citizen_v516_accounts SET moderation_status='BANNED' WHERE citizen_id=$1",[citizenId]);
   assert.equal((await auth.resolveSession(tokenA,midA))?.blocked,true);
   await assert.rejects(resolveTrafficCitizenIdentityV516(
     {municipalityId:midA,sessionToken:tokenA},auth.resolveSession.bind(auth)),code("CITIZEN_SUBMISSION_BLOCKED"));
   await assert.rejects(auth.login({municipalityId:midA,login:"joao.da.silva",password}),code("CITIZEN_LOGIN_INVALID"));
   await assert.rejects(auth.signup(form(midA,"outro.nome")),code("CITIZEN_MODERATION_BLOCKED"));
   await owner.query("UPDATE app.citizen_v516_accounts SET moderation_status='WARNING' WHERE citizen_id=$1",[citizenId]);
   assert.equal((await auth.resolveSession(tokenA,midA))?.blocked,false);
  });
  await t.test("suspensão com prazo vencido permite retorno sem retirar histórico",async()=>{
   await owner.query("UPDATE app.citizen_v516_accounts SET moderation_status='SUSPENDED',suspended_until=clock_timestamp()-interval '1 minute' WHERE citizen_id=$1",[citizenId]);
   assert.equal((await auth.resolveSession(tokenA,midA))?.blocked,false);
   await owner.query("UPDATE app.citizen_v516_accounts SET suspended_until=NULL WHERE citizen_id=$1",[citizenId]);
   assert.equal((await auth.resolveSession(tokenA,midA))?.blocked,true);
  });
  await t.test("sessão expirada/inativa ou conta desativada falham fechadas",async()=>{
   await owner.query("UPDATE app.citizen_v516_accounts SET moderation_status='ACTIVE' WHERE citizen_id=$1",[citizenId]);
   await owner.query("UPDATE app.citizen_v516_sessions SET last_seen_at=clock_timestamp()-interval '16 minutes' WHERE token_hash=$1",[createHash("sha256").update(tokenA).digest("hex")]);
   assert.equal(await auth.resolveSession(tokenA,midA),null);
   const token2=(await auth.login({municipalityId:midA,login:"joao.da.silva",password})).accessToken;
   await owner.query("UPDATE app.citizen_v516_accounts SET active=false WHERE citizen_id=$1",[citizenId]);
   assert.equal(await auth.resolveSession(token2,midA),null);
  });
  await t.test("logout revoga apenas a sessão conhecida",async()=>{
   const another=await auth.signup(form(midA,"cidadão.outro","(88) 90000-0003"));
   assert(await auth.resolveSession(another.accessToken,midA));
   await auth.logout(another.accessToken);
   assert.equal(await auth.resolveSession(another.accessToken,midA),null);
  });
  await t.test("sem protocolo fictício em banco, mídia não aprovada continua inativa",async()=>{
   const q=await owner.query("SELECT count(*)::int AS n FROM app.citizen_v516_accounts");
   assert(q.rows[0].n>=2);
   assert.equal((await owner.query("SELECT to_regclass('app.citizen_traffic_protocols') AS t")).rows[0].t,null);
  });
 }finally{
  await auth.close().catch(()=>{});
  await restricted.end().catch(()=>{});
  await owner.end().catch(()=>{});
 }
});
