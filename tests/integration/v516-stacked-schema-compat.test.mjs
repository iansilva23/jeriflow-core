import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import pg from "pg";
import {CitizenAccountsV516} from "../../apps/api/src/citizen-accounts-v516.ts";
import {TrafficPhotoOwnershipV516} from "../../apps/api/src/traffic-photo-ownership-v516.ts";

const ownerDsn=process.env.JF_V516_TEST_OWNER_DSN;
const appDsn=process.env.JF_V516_TEST_APP_DSN;
if(!ownerDsn||!appDsn)throw Error("EPHEMERAL_POSTGRES_REQUIRED");
const sha=x=>createHash("sha256").update(x).digest("hex");
const names=[
 "001-identity.sql","002-identity-security.sql","003-account-management.sql",
 "004-citizen-v516.sql","005-citizen-v516-traffic-protocol.sql",
 "006-citizen-v516-scanned-photo-worker.sql",
 "007-citizen-v516-traffic-photo-owner.sql",
 "008-citizen-v516-traffic-confirm-ack.sql",
 "009-citizen-v516-traffic-idempotency.sql",
 "010-citizen-v516-photo-reconciliation-preview.sql",
 "020-parking-v516-register-extensions-exit.sql",
 "021-parking-v516-admin-queries.sql",
 "022-parking-v516-access-tokens.sql"
];
test("V5.16: conta Cidadão e ADM Turismo coexistem no MESMO PostgreSQL sem misturar dados",
 {timeout:130000},async t=>{
 const owner=new pg.Client({connectionString:ownerDsn});
 const app=new pg.Client({connectionString:appDsn});
 const citizen=new CitizenAccountsV516(appDsn);
 const photo=new TrafficPhotoOwnershipV516(appDsn);
 const mid=randomUUID(),otherMid=randomUUID();
 const adminToken=randomBytes(32).toString("base64url");
 try{
  await owner.connect();
  await owner.query(
   "CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-jeriflow-test-only'");
  await owner.query("CREATE SCHEMA app");
  await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
  for(const file of names){
   const sql=readFileSync(new URL("../../infra/migrations/"+file,import.meta.url),"utf8");
   assert(sql.length>50,"migração vazia ou ignorada: "+file);
   await owner.query(sql);
  }
  await owner.query("INSERT INTO app.municipalities(id,slug,display_name) "+
   "VALUES($1,'integration-v516-one','Cidade Sintética A'),"+
   "($2,'integration-v516-two','Cidade Sintética B')",[mid,otherMid]);
  const adminId=randomUUID();
  await owner.query(
   "INSERT INTO app.identity_users(id,email,display_name,password_hash,"+
   "email_verified_at,mfa_secret,mfa_version) "+
   "VALUES($1,'integrated-tourism@example.invalid','Operador Sintético',"+
   "'test-only',clock_timestamp(),'test-totp',1)",[adminId]);
  await owner.query("INSERT INTO app.memberships(user_id,municipality_id,role_code) "+
   "VALUES($1,$2,'admin-turismo')",[adminId,mid]);
  await owner.query(
   "INSERT INTO app.identity_sessions(token_hash,user_id,auth_version,"+
   "mfa_version,mfa_verified_at) VALUES($1,$2,1,1,clock_timestamp())",
   [sha(adminToken),adminId]);
  await owner.query(
   "INSERT INTO app.parking_v516_tariffs(municipality_id,daily_rate_cents,enabled,approved_by) "+
   "VALUES($1,4000,true,$2)",[mid,adminId]);
  await app.connect();
  const registered=await citizen.signup({
   municipalityId:mid,name:"Pessoa Cidadã de Teste",
   birthDate:"1995-06-01",phone:"(88) 90000-0000",
   address:"Rua Fictícia",login:"integration.citizen",
   password:"SenhaDeTeste123",confirmPassword:"SenhaDeTeste123"
  });
  assert(registered.accessToken,"cadastro real de cidadão retorna sessão própria");

  await t.test("13 migrações sem conflitos e papéis internos segregados",async()=>{
   const tables=(await owner.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='app'"
   )).rows.map(x=>x.tablename);
   for(const table of [
    "identity_users","citizen_v516_accounts",
    "citizen_v516_traffic_protocols",
    "citizen_v516_traffic_photo_owners",
    "citizen_v516_traffic_attempts",
    "parking_v516_tariffs","parking_v516_registrations",
    "parking_v516_movements","parking_v516_access_keys"
   ])assert(tables.includes(table),"falta tabela "+table);
   assert(!tables.includes("tts_official_payments"),
     "estacionamento não inventa pagamentos da TTS");
   const roles=(await owner.query(
    "SELECT rolname FROM pg_roles WHERE rolname IN ("+
    "'jeriflow_app','jeriflow_v516_scan_worker','jeriflow_v516_reconciler')"
   )).rows.map(x=>x.rolname);
   assert.equal(roles.length,3);
  });
  await t.test("Cidadão pode registrar titularidade de foto sem tocar Estacionamento",async()=>{
   const photoId=randomUUID(),contentHash=sha("photo-synthetic-not-real");
   await photo.reserveRegistered({
    municipalityId:mid,sessionToken:registered.accessToken,
    ticket:{municipalityId:mid,photoId,sha256:contentHash,
     mime:"image/webp",stored:true,normalized:true,metadataRemoved:true,
     malwareScanned:false,evidenceApproved:false,protocolCreated:false,
     publicUrl:null,byteLength:120,width:20,height:10}
   });
   const count=await owner.query(
    "SELECT count(*)::integer AS n FROM app.citizen_v516_traffic_photo_owners");
   assert.equal(count.rows[0].n,1);
   assert.equal((await owner.query(
    "SELECT count(*)::integer AS n FROM app.parking_v516_registrations"
   )).rows[0].n,0);
   assert.equal((await owner.query(
    "SELECT count(*)::integer AS n FROM app.citizen_v516_traffic_protocols"
   )).rows[0].n,0,"foto reservada não envia denúncia");
  });
  await t.test("ADM Turismo cadastra sem conferir documentos TTS nem entrar em Ouvidoria",async()=>{
   const payload={
    plate:"ABC1D23",brand:"Toyota",model:"Etios",year:2025,
    entryAt:new Date(Date.now()-3600000).toISOString(),
    days:1,responsible:"Turista Sintético",
    tourists:["Turista Sintético"],hotel:"Hospedagem Teste",
    noRefundAcknowledged:false,paymentMethod:"PIX"
   };
   const result=await app.query(
    "SELECT app.parking_v516_register($1::uuid,$2::text,$3::uuid,$4::jsonb) AS id",
    [mid,sha(adminToken),randomUUID(),payload]);
   assert.match(result.rows[0].id,/^[a-f0-9-]{36}$/);
   const p=(await app.query(
    "SELECT app.parking_v516_admin_summary($1::uuid,$2::text) AS info",
    [mid,sha(adminToken)])).rows[0].info;
   assert.equal(p.occupied,1);
   assert.equal(Number(p.receivedCents),4000);
   assert.equal((await owner.query(
    "SELECT count(*)::integer AS n FROM app.citizen_v516_traffic_protocols"
   )).rows[0].n,0);
   assert.equal((await owner.query(
    "SELECT count(*)::integer AS n FROM app.citizen_v516_traffic_photo_owners"
   )).rows[0].n,1);
  });
  await t.test("API continua sem CRUD direto em dados pessoais dos dois módulos",async()=>{
   for(const table of [
    "citizen_v516_traffic_protocols","citizen_v516_traffic_photo_owners",
    "parking_v516_registrations","parking_v516_movements",
    "parking_v516_access_keys"
   ])await assert.rejects(
     app.query("SELECT * FROM app."+table),e=>e?.code==="42501");
   const privileges=await owner.query(
    "SELECT has_function_privilege('jeriflow_app',"+
    "'app.parking_v516_admin_list(uuid,text,uuid,integer,text)','EXECUTE') AS parking,"+
    "has_function_privilege('jeriflow_app',"+
    "'app.citizen_v516_traffic_submit(uuid,text,text,text,date,text,text,text,text,text,uuid,text)',"+
    "'EXECUTE') AS traffic");
   assert.equal(privileges.rows[0].parking,true);
   assert.equal(privileges.rows[0].traffic,true);
  });
  await t.test("município B não vê cadastro do município A",async()=>{
   await assert.rejects(app.query(
    "SELECT app.parking_v516_admin_summary($1::uuid,$2::text)",
    [otherMid,sha(adminToken)]),e=>e?.code==="JF003");
   const results=await owner.query(
    "SELECT count(*)::integer AS n FROM app.parking_v516_registrations "+
    "WHERE municipality_id=$1",[otherMid]);
   assert.equal(results.rows[0].n,0);
  });
 }finally{
  await photo.close().catch(()=>{});
  await citizen.close().catch(()=>{});
  await app.end().catch(()=>{});
  await owner.end().catch(()=>{});
 }
});
