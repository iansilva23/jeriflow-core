import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import pg from "pg";
import {ParkingAccessServiceV516} from "../../apps/api/src/parking-access-v516.ts";
const ownerDsn=process.env.JF_V516_TEST_OWNER_DSN;
const appDsn=process.env.JF_V516_TEST_APP_DSN;
if(!ownerDsn||!appDsn)throw Error("EPHEMERAL_POSTGRES_REQUIRED");
const sha=x=>createHash("sha256").update(x).digest("hex");
const mid=randomUUID(),otherMid=randomUUID();
const adminToken=randomBytes(32).toString("base64url");
const touristToken=randomBytes(32).toString("base64url");
const by=code=>e=>e?.code===code;
const data=(plate,offsetHours=2)=>({
  plate,brand:"VW",model:"Gol",year:2022,
  entryAt:new Date(Date.now()-offsetHours*3600000).toISOString(),
  days:1,responsible:"Cliente exemplo",tourists:["Cliente exemplo"],
  hotel:"Pousada local fictícia",document:"TEST-0001",
  phone:"88000000000",notes:"Teste sem dados reais",
  noRefundAcknowledged:false,paymentMethod:"PIX"
});
test("V5.16 Turista: token privado seguro e revogação; estacionamento != TTS",
 {timeout:100000},async t=>{
 const owner=new pg.Client({connectionString:ownerDsn});
 const app=new pg.Client({connectionString:appDsn});
 const key=randomBytes(32);
 let service;
 try{
  await owner.connect();
  await owner.query(
   "CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-jeriflow-test-only'");
  await owner.query("CREATE SCHEMA app");
  await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
  for(const name of [
   "001-identity.sql","002-identity-security.sql","003-account-management.sql",
   "020-parking-v516-register-extensions-exit.sql",
   "021-parking-v516-admin-queries.sql","022-parking-v516-access-tokens.sql"
  ])await owner.query(readFileSync(new URL(
   "../../infra/migrations/"+name,import.meta.url),"utf8"));
  await owner.query("INSERT INTO app.municipalities(id,slug,display_name) "+
   "VALUES($1,'token-test-one','Município Fictício Um'),($2,'token-test-two','Município Fictício Dois')",
   [mid,otherMid]);
  async function addUser(email,token,role){
   const id=randomUUID();
   await owner.query(
    "INSERT INTO app.identity_users(id,email,display_name,password_hash,"+
    "email_verified_at,mfa_secret,mfa_version) "+
    "VALUES($1,$2,'Fictício','test-only',clock_timestamp(),'test-totp',1)",
    [id,email]);
   await owner.query("INSERT INTO app.memberships(user_id,municipality_id,role_code) VALUES($1,$2,$3)",
    [id,mid,role]);
   await owner.query(
    "INSERT INTO app.identity_sessions(token_hash,user_id,auth_version,"+
    "mfa_version,mfa_verified_at) VALUES($1,$2,1,1,clock_timestamp())",
    [sha(token),id]);
   return id;
  }
  const admin=await addUser("token-admin@example.invalid",adminToken,"admin-turismo");
  await addUser("token-tourist@example.invalid",touristToken,"turista");
  await owner.query(
   "INSERT INTO app.parking_v516_tariffs(municipality_id,daily_rate_cents,enabled,approved_by)"+
   " VALUES($1,4000,true,$2)",[mid,admin]);
  await app.connect();
  const create=async(plate,hours=2)=>(await app.query(
   "SELECT app.parking_v516_register($1::uuid,$2::text,$3::uuid,$4::jsonb) AS id",
   [mid,sha(adminToken),randomUUID(),data(plate,hours)])).rows[0].id;
  const first=await create("ABC1D23");
  service=new ParkingAccessServiceV516({databaseUrl:appDsn,encryptionKey:key});
  const auth={municipalityId:mid,sessionToken:adminToken,registrationId:first};
  let token;
  await t.test("somente operador autorizado emite chave criptográfica de viagem",async()=>{
   token=await service.issue(auth);
   assert.match(token,/^JFPK-[A-HJ-NP-Z2-9-]{30,}$/);
   assert.equal(token.length,35);
   const saved=(await owner.query(
    "SELECT token_hash,token_ciphertext,token_iv,token_tag "+
    "FROM app.parking_v516_access_keys WHERE registration_id=$1",[first])).rows[0];
   assert.equal(saved.token_hash,sha(token));
   assert.equal(saved.token_iv.length,12);
   assert.equal(saved.token_tag.length,16);
   assert(!saved.token_ciphertext.toString("utf8").includes(token));
   assert.equal(await service.reprint(auth),token);
   await assert.rejects(service.issue(auth),
    e=>e.code==="PARKING_ACCESS_DENIED");
  });
  await t.test("App Turista obtém somente dados da estadia, sem TTS ou PII extra",async()=>{
   const r=await service.validate(token);
   assert.equal(r.valid,true);
   assert.equal(r.parking.registrationId,first);
   assert.equal(r.parking.plate,"ABC1D23");
   assert.equal(r.parking.hotel,"Pousada local fictícia");
   assert.equal(r.parking.paidDays,1);
   assert.equal(r.parking.totalPaidCents,4000);
   assert(!Object.keys(r.parking).includes("document"));
   assert(!Object.keys(r.parking).includes("tourists"));
   assert(!Object.keys(r.parking).includes("ttsToken"));
   assert.deepEqual(await service.validate("JFPK-FAKE"),{valid:false});
   assert.deepEqual(await service.validate(
     "JFPK-"+randomBytes(26).toString("hex").slice(0,26).toUpperCase()
   ),{valid:false});
  });
  await t.test("reimpressão e consulta administrativa negadas fora de MFA/município",async()=>{
   await assert.rejects(service.reprint({...auth,sessionToken:touristToken}),
    e=>e.code==="PARKING_ACCESS_DENIED");
   await assert.rejects(service.reprint({...auth,municipalityId:otherMid}),
    e=>e.code==="PARKING_ACCESS_DENIED");
   await assert.rejects(app.query(
    "SELECT * FROM app.parking_v516_access_keys"),by("42501"));
   await assert.rejects(app.query(
    "SELECT * FROM app.parking_v516_access_audit"),by("42501"));
  });
  await t.test("outro segredo AES não consegue revelar a chave salva",async()=>{
   const incorrect=new ParkingAccessServiceV516({
    databaseUrl:appDsn,encryptionKey:randomBytes(32)
   });
   try{
    await assert.rejects(incorrect.reprint(auth),
      e=>e.code==="PARKING_ACCESS_INTEGRITY");
   }finally{await incorrect.close();}
   assert.equal(await service.reprint(auth),token);
  });
  await t.test("revogação invalida voucher antigo; reemissão cria outra chave",async()=>{
   await service.revoke({...auth,reason:"Chave de voucher cancelada pela coordenação"});
   assert.deepEqual(await service.validate(token),{valid:false});
   await assert.rejects(service.reprint(auth),e=>e.code==="PARKING_ACCESS_DENIED");
   const replacement=await service.issue(auth);
   assert.notEqual(replacement,token);
   assert.deepEqual(await service.validate(token),{valid:false});
   assert.equal((await service.validate(replacement)).valid,true);
   token=replacement;
   const events=(await owner.query(
    "SELECT event FROM app.parking_v516_access_audit "+
    "WHERE registration_id=$1 ORDER BY occurred_at",[first])).rows.map(x=>x.event);
   assert(events.includes("ISSUED")&&events.includes("REVOKED")&&
     events.includes("REISSUED")&&events.includes("REPRINTED"));
  });
  await t.test("estadia ativa continua válida se só vencer diária, sem saída",async()=>{
   const overdue=await create("XYZ9A88",60);
   const overdueAuth={municipalityId:mid,sessionToken:adminToken,registrationId:overdue};
   const raw=await service.issue(overdueAuth);
   assert.equal((await service.validate(raw)).valid,true);
   await app.query("SELECT app.parking_v516_confirm_exit("+
    "$1::uuid,$2::text,$3::uuid,$4::uuid,$5::text,$6::text)",
    [mid,sha(adminToken),randomUUID(),overdue,"TOLERANCE",
     "Decisão manual de tolerância após vencimento"]);
   assert.deepEqual(await service.validate(raw),{valid:false});
  });
  await t.test("saída física encerra acesso; TTS não é alterada",async()=>{
   await app.query("SELECT app.parking_v516_confirm_exit("+
    "$1::uuid,$2::text,$3::uuid,$4::uuid,$5::text,$6::text)",
    [mid,sha(adminToken),randomUUID(),first,"NORMAL",""]);
   assert.deepEqual(await service.validate(token),{valid:false});
   await assert.rejects(service.issue(auth),
    e=>e.code==="PARKING_ACCESS_DENIED");
   assert.equal((await owner.query(
    "SELECT count(*)::integer AS n FROM app.parking_v516_access_keys")).rows[0].n,2);
  });
 }finally{
  await service?.close().catch(()=>{});
  await app.end().catch(()=>{});
  await owner.end().catch(()=>{});
 }
});
