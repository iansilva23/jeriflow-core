import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import pg from "pg";
import {CitizenAccountsV516} from "../../apps/api/src/citizen-accounts-v516.ts";

// NO production connections. Only ephemeral PostgreSQL provisioned for CI.
const ownerDsn=process.env.JF_V516_TEST_OWNER_DSN;
const appDsn=process.env.JF_V516_TEST_APP_DSN;
if(!ownerDsn||!appDsn)throw Error("EPHEMERAL_POSTGRES_REQUIRED");
const owner=new pg.Client({connectionString:ownerDsn});
const app=new pg.Client({connectionString:appDsn});
const accounts=new CitizenAccountsV516(appDsn);
const hash=x=>createHash("sha256").update(x).digest("hex");
const type="Estacionamento irregular", location="Rua fictícia em Jericoacoara";
function input(mid,tokenHash,guestHash,photo,sha,overrides={}){
 return [mid,tokenHash,guestHash,"Pessoa visitante","2001-02-03","(88) 90000-0000",
  type,location,"ABC1234","Veículo impedindo passagem na via pública",photo,sha].map((x,i)=>
   Object.hasOwn(overrides,i)?overrides[i]:x);
}
async function submit(params){
 return app.query("SELECT app.citizen_v516_traffic_submit($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12) AS id",params);
}
const by=code=>e=>e?.code===code;
test("V5.16: protocolo único transacional em PostgreSQL REAL (dados exclusivamente sintéticos)",{timeout:120_000},async t=>{
 await owner.connect();
 try{
  await owner.query("CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-jeriflow-test-only'");
  await owner.query("CREATE SCHEMA app");
  await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
  for(const file of ["001-identity.sql","002-identity-security.sql","003-account-management.sql",
   "004-citizen-v516.sql","005-citizen-v516-traffic-protocol.sql"]){
   await owner.query(readFileSync(new URL("../../infra/migrations/"+file,import.meta.url),"utf8"));
  }
  await app.connect();
  const midA=randomUUID(),midB=randomUUID();
  await owner.query("INSERT INTO app.municipalities(id,slug,display_name) VALUES ($1,'v516-a','Fictício A'),($2,'v516-b','Fictício B')",[midA,midB]);
  const user=await accounts.signup({municipalityId:midA,name:"Denunciante Cadastro",birthDate:"1999-01-01",
   phone:"(88) 90000-0000",address:"Vila fictícia",login:"conta.cidadão",
   password:"Senha123",confirmPassword:"Senha123"});
  const tokenHash=hash(user.accessToken);
  const photo=randomUUID(),sha=hash("synthetic-webp-verified-for-db-test");
  const data=input(midA,tokenHash,null,photo,sha);
  const count=async()=>(await owner.query("SELECT count(*)::int AS n FROM app.citizen_v516_traffic_protocols")).rows[0].n;

  await t.test("sem fotografia registrada por worker confiável, não emite protocolo",async()=>{
   await assert.rejects(submit(data),by("JF004"));
   assert.equal(await count(),0);
  });
  await t.test("API não consegue injetar foto verificada nem tabela paralela",async()=>{
   await assert.rejects(app.query("INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",[photo,midA,sha]),by("42501"));
   await assert.rejects(app.query("SELECT * FROM app.citizen_v516_traffic_protocols"),by("42501"));
   assert.equal((await owner.query("SELECT to_regclass('app.guard_occurrences') AS t")).rows[0].t,null);
  });
  await owner.query("INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",[photo,midA,sha]);
  let id;
  await t.test("cadastro V5.16 cria exatamente o mesmo protocolo canônico com foto única",async()=>{
   const result=await submit(data);id=result.rows[0].id;
   assert.match(id,/^JF-\d{8}-\d{6,}$/);
   const found=await owner.query("SELECT * FROM app.citizen_v516_traffic_protocols WHERE id=$1",[id]);
   assert.equal(found.rowCount,1);
   const r=found.rows[0];
   assert.equal(r.category,"Trânsito (SEMUS)");
   assert.equal(r.destination,"SEMUS / Guarda de trânsito");
   assert.equal(r.status,"RECEBIDA");
   assert.equal(r.title,type);
   assert.equal(r.has_photo,true);
   assert.equal(r.identity_name,"Denunciante Cadastro");
   assert.equal(r.identity_login,"conta.cidadao");
   assert.equal(r.guest_device_hash,null);
   assert.equal(r.photo_id,photo);
   assert.equal((await owner.query("SELECT consumed_by FROM app.citizen_v516_verified_traffic_media WHERE photo_id=$1",[photo])).rows[0].consumed_by,id);
   assert.equal(await count(),1);
  });
  await t.test("reusar a foto não cria outro protocolo e não gera ocorrência da Guarda",async()=>{
   await assert.rejects(submit(data),by("JF004"));
   assert.equal(await count(),1);
  });
  await t.test("outro município não pode usar foto ou sessão já usada",async()=>{
   const second=randomUUID(),shaSecond=hash("another-media");
   await owner.query("INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",[second,midA,shaSecond]);
   await assert.rejects(submit(input(midB,tokenHash,null,second,shaSecond)),by("JF003"));
   assert.equal(await count(),1);
  });
  await t.test("banimento do Cidadão impede novo protocolo",async()=>{
   await owner.query("UPDATE app.citizen_v516_accounts SET moderation_status='BANNED' WHERE citizen_id=$1",[user.citizenId]);
   const photo2=randomUUID(),sha2=hash("blocked-photo");
   await owner.query("INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",[photo2,midA,sha2]);
   await assert.rejects(submit(input(midA,tokenHash,null,photo2,sha2)),by("JF003"));
   await owner.query("UPDATE app.citizen_v516_accounts SET moderation_status='ACTIVE' WHERE citizen_id=$1",[user.citizenId]);
  });
  await t.test("visitante identificado tem nome/nascimento/telefone e vínculo privado ao dispositivo",async()=>{
   const guestPhoto=randomUUID(),guestSha=hash("guest-image"),device=hash("synthetic-device-secret");
   await owner.query("INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",[guestPhoto,midA,guestSha]);
   const row=await submit(input(midA,null,device,guestPhoto,guestSha));
   const found=await owner.query("SELECT * FROM app.citizen_v516_traffic_protocols WHERE id=$1",[row.rows[0].id]);
   assert.equal(found.rows[0].citizen_account_id,null);
   assert.equal(found.rows[0].guest_device_hash,device);
   assert.equal(found.rows[0].identity_name,"Pessoa visitante");
   assert.equal(found.rows[0].identity_phone,"(88) 90000-0000");
   assert.equal(found.rows[0].status,"RECEBIDA");
   assert.equal(await count(),2);
  });
  await t.test("identificação incompleta de visitante falha sem consumir evidência",async()=>{
   const guestPhoto=randomUUID(),guestSha=hash("guest-failure"),device=hash("synthetic-device");
   await owner.query("INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",[guestPhoto,midA,guestSha]);
   await assert.rejects(submit(input(midA,null,device,guestPhoto,guestSha,{3:""})),by("JF001"));
   assert.equal((await owner.query("SELECT consumed_by FROM app.citizen_v516_verified_traffic_media WHERE photo_id=$1",[guestPhoto])).rows[0].consumed_by,null);
  });
  await t.test("tipo fora das sete opções da V5.16 não gera protocolo",async()=>{
   const badPhoto=randomUUID(),badSha=hash("bad-form");
   await owner.query("INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",[badPhoto,midA,badSha]);
   await assert.rejects(submit(input(midA,tokenHash,null,badPhoto,badSha,{6:"Categoria inventada"})),by("JF001"));
   assert.equal(await count(),2);
  });
  await t.test("mesma fotografia não atravessa município e chave composta obriga origem",async()=>{
   const future=randomUUID(),proof=hash("mid-check");
   await owner.query("INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",[future,midB,proof]);
   await assert.rejects(submit(input(midA,tokenHash,null,future,proof)),by("JF004"));
   assert.equal(await count(),2);
  });
 }finally{
  await accounts.close().catch(()=>{});
  await app.end().catch(()=>{});
  await owner.end().catch(()=>{});
 }
});
