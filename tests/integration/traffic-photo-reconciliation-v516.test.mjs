import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {mkdtemp,rm,readdir,symlink} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import pg from "pg";
import sharp from "sharp";
import {CitizenAccountsV516} from "../../apps/api/src/citizen-accounts-v516.ts";
import {TrafficCleanPhotoStoreV516} from "../../apps/api/src/traffic-photo-clean-store-v516.ts";
import {TrafficPhotoReconcilerV516} from "../../apps/api/src/traffic-photo-reconciliation-v516.ts";
import {digest} from "../../apps/api/src/identity-primitives.ts";

const ownerDsn=process.env.JF_V516_TEST_OWNER_DSN;
const appDsn=process.env.JF_V516_TEST_APP_DSN;
const reconcilerDsn=process.env.JF_V516_TEST_RECONCILER_DSN;
if(!ownerDsn||!appDsn||!reconcilerDsn)throw Error("EPHEMERAL_POSTGRES_REQUIRED");
const hash=x=>createHash("sha256").update(x).digest("hex");
const mid=randomUUID(),otherMid=randomUUID();
const by=code=>e=>e?.code===code;
async function createPhoto(store,owner,accountId,{
  verified=false,old=true,color="#dfb886"
}={}){
 const image=await sharp({create:{width:320,height:180,channels:3,background:color}})
    .webp({quality:70,effort:4}).toBuffer();
 const sha=hash(image),ticket=await store.store(mid,{
  bytes:image,sha256:sha,originalSha256:hash("synthetic-original-"+color),
  byteLength:image.length,width:320,height:180,mime:"image/webp",
  maxWidthFromV516:1200,qualityFromV516:70,sourceMime:"image/png",
  imageDecoded:true,metadataRemoved:true,stored:false,
  malwareScanned:false,evidenceApproved:false,protocolCreated:false,
 });
 await owner.query(
  "INSERT INTO app.citizen_v516_traffic_photo_owners("+
  "photo_id,municipality_id,citizen_account_id,sha256,reserved_at) "+
  "VALUES($1,$2,$3,$4,clock_timestamp()-($5::integer * interval '1 hour'))",
  [ticket.photoId,mid,accountId,sha,old?100:0]);
 if(verified)await owner.query(
  "INSERT INTO app.citizen_v516_verified_traffic_media"+
  "(photo_id,municipality_id,sha256,verified_at) "+
  "VALUES($1,$2,$3,clock_timestamp()-interval '100 hours')",
  [ticket.photoId,mid,sha]);
 return ticket;
}
test("V5.16: reconciliação read-only protege protocolos e audita órfãos com WebP reais",
 {timeout:160000},async t=>{
 const owner=new pg.Client({connectionString:ownerDsn});
 const app=new pg.Client({connectionString:appDsn});
 const reconcilerRole=new pg.Client({connectionString:reconcilerDsn});
 const accounts=new CitizenAccountsV516(appDsn);
 const root=await mkdtemp(join(tmpdir(),"jf516-reconcile-"));
 let inspector;
 try {
  await owner.connect();
  await owner.query("CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-jeriflow-test-only'");
  await owner.query("CREATE SCHEMA app");
  await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
  for(const migration of [
    "001-identity.sql","002-identity-security.sql",
    "003-account-management.sql","004-citizen-v516.sql",
    "005-citizen-v516-traffic-protocol.sql",
    "006-citizen-v516-scanned-photo-worker.sql",
    "007-citizen-v516-traffic-photo-owner.sql",
    "008-citizen-v516-traffic-confirm-ack.sql",
    "009-citizen-v516-traffic-idempotency.sql",
    "010-citizen-v516-photo-reconciliation-preview.sql",
  ])await owner.query(readFileSync(new URL(
    "../../infra/migrations/"+migration,import.meta.url),"utf8"));
  await owner.query("CREATE ROLE jeriflow_reconcile_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-reconcile-test-only'");
  await owner.query("GRANT jeriflow_v516_reconciler TO jeriflow_reconcile_test");
  await owner.query(
   "INSERT INTO app.municipalities(id,slug,display_name) "+
   "VALUES($1,'reconcile-a','Município fictício A'),($2,'reconcile-b','Município fictício B')",
   [mid,otherMid]);
  await app.connect();await reconcilerRole.connect();
  const a=await accounts.signup({municipalityId:mid,name:"Cidadã A fictícia",
    birthDate:"1994-03-10",phone:"(88) 90000-0000",address:"Rua Fictícia",
    login:"reconcile.a",password:"SenhaFicticia123",confirmPassword:"SenhaFicticia123"});
  const b=await accounts.signup({municipalityId:mid,name:"Cidadão B fictício",
    birthDate:"1995-04-11",phone:"(88) 91111-1111",address:"Rua Sem Número",
    login:"reconcile.b",password:"SenhaFicticia123",confirmPassword:"SenhaFicticia123"});
  const accountId=async cid=>(await owner.query(
    "SELECT id FROM app.citizen_v516_accounts WHERE citizen_id=$1",[cid])).rows[0].id;
  const aid=await accountId(a.citizenId),bid=await accountId(b.citizenId);
  const store=await TrafficCleanPhotoStoreV516.openPrivate(root);
  const protocolPhoto=await createPhoto(store,owner,aid,{verified:true,color:"#8bbbcc"});
  const submitted=await app.query(
    "SELECT app.citizen_v516_traffic_submit("+
    "$1::uuid,$2::text,NULL::text,NULL::text,NULL::date,NULL::text,"+
    "$3::text,$4::text,$5::text,$6::text,$7::uuid,$8::text) AS id",
    [mid,digest(a.accessToken),"Estacionamento irregular",
     "Rua Fictícia","ABC1234","Foto fictícia já vinculada ao protocolo",
     protocolPhoto.photoId,protocolPhoto.sha256]);
  assert.match(submitted.rows[0].id,/^JF-/);
  const orphanVerified=await createPhoto(store,owner,bid,{verified:true,color:"#add9aa"});
  const orphanUnverified=await createPhoto(store,owner,bid,{verified:false,color:"#e8bbaa"});
  await createPhoto(store,owner,bid,{verified:true,old:false,color:"#f5efaa"});
  const missingId=randomUUID();
  await owner.query(
    "INSERT INTO app.citizen_v516_traffic_photo_owners("+
    "photo_id,municipality_id,citizen_account_id,sha256,reserved_at) "+
    "VALUES($1,$2,$3,$4,clock_timestamp()-interval '100 hours')",
    [missingId,mid,bid,hash("missing-photo-synthetic")]);
  inspector=await TrafficPhotoReconcilerV516.openPrivate({
    reconcilerDatabaseUrl:reconcilerDsn,cleanPhotoRoot:root
  });

  await t.test("API/worker não conseguem consultar nem ler mídia candidata",async()=>{
    await assert.rejects(app.query(
      "SELECT * FROM app.citizen_v516_traffic_reconcile_preview($1,72,50)",
      [mid]),by("42501"));
    await assert.rejects(app.query(
      "SELECT * FROM app.citizen_v516_traffic_photo_owners"),by("42501"));
    await assert.rejects(reconcilerRole.query(
      "SELECT * FROM app.citizen_v516_traffic_photo_owners"),by("42501"));
  });
  await t.test("período mínimo 72 horas e limites estritos",async()=>{
    for(const opts of [{olderThanHours:1},{olderThanHours:71},
      {olderThanHours:8761},{limit:0},{limit:101}]){
      await assert.rejects(inspector.inspect({municipalityId:mid,...opts}),
        e=>e?.code==="RECONCILIATION_INVALID_REQUEST");
    }
  });
  await t.test("encontra apenas órfãos antigos, protege protocolo e foto recente",async()=>{
    const before=await readdir(join(root,mid));
    const result=await inspector.inspect({municipalityId:mid,olderThanHours:72});
    assert.deepEqual(result,{
      evaluated:3,withScannerRecord:1,withoutScannerRecord:2,
      readablePrivateFiles:2,missingPrivateFiles:1,
      unsafeOrInconsistentFiles:0,deletedFiles:0,
      deletedDatabaseRows:0,mode:"READ_ONLY"
    });
    assert.deepEqual(await readdir(join(root,mid)),before);
    assert.equal((await owner.query(
      "SELECT count(*)::int AS n FROM app.citizen_v516_traffic_protocols"
    )).rows[0].n,1);
    const separate=await inspector.inspect({municipalityId:otherMid});
    assert.equal(separate.evaluated,0,"município vizinho não recebe resultados");
  });
  await t.test("tentativa recente do mesmo dono bloqueia QUALQUER candidato",async()=>{
    const key=hash("synthetic-reconcile-inflight");
    await owner.query(
      "INSERT INTO app.citizen_v516_traffic_attempts("+
      "municipality_id,citizen_account_id,payload_sha256,technical_state,lease_id,lease_expires_at) "+
      "VALUES($1,$2,$3,'PROCESSING',$4,clock_timestamp()+interval '5 minutes')",
      [mid,bid,key,randomUUID()]);
    const result=await inspector.inspect({municipalityId:mid});
    assert.equal(result.evaluated,0);
    await owner.query(
      "UPDATE app.citizen_v516_traffic_attempts "+
      "SET updated_at=clock_timestamp()-interval '100 hours', "+
      "lease_expires_at=clock_timestamp()-interval '100 hours' "+
      "WHERE municipality_id=$1 AND payload_sha256=$2",[mid,key]);
    const next=await inspector.inspect({municipalityId:mid});
    assert.equal(next.evaluated,3);
  });
  await t.test("referência a tentativa PHOTO_READY protege mídia embora antiga",async()=>{
    const oldKey=hash("synthetic-reconcile-photo-ready");
    await owner.query(
      "INSERT INTO app.citizen_v516_traffic_attempts("+
      "municipality_id,citizen_account_id,payload_sha256,technical_state,lease_id,lease_expires_at,"+
      "photo_id,photo_sha256,updated_at) VALUES("+
      "$1,$2,$3,'PHOTO_READY',$4,clock_timestamp()-interval '100 hours',"+
      "$5,$6,clock_timestamp()-interval '100 hours')",
      [mid,bid,oldKey,randomUUID(),orphanVerified.photoId,orphanVerified.sha256]);
    const report=await inspector.inspect({municipalityId:mid});
    assert.equal(report.evaluated,2);
  });
  await t.test("symlink suspeito não é lido e não é apagado",async()=>{
    const manifest=join(root,mid,orphanUnverified.photoId+".json");
    // Arquivo privado deste candidato vira um symlink fraudulento.
    const {rename}=await import("node:fs/promises");
    await rename(manifest,manifest+".bak");
    await symlink("/etc/passwd",manifest);
    const r=await inspector.inspect({municipalityId:mid});
    assert.equal(r.evaluated,2);
    assert.equal(r.missingPrivateFiles,1);
    assert.equal(r.unsafeOrInconsistentFiles,1);
    assert.equal(r.deletedFiles,0);
    assert((await readdir(join(root,mid))).includes(orphanUnverified.photoId+".json"),
      "arquivo simbólico é preservado para auditoria, jamais seguido");
  });
 }finally{
  await inspector?.close().catch(()=>{});
  await accounts.close().catch(()=>{});
  await reconcilerRole.end().catch(()=>{});
  await app.end().catch(()=>{});
  await owner.end().catch(()=>{});
  await rm(root,{recursive:true,force:true});
 }
});
