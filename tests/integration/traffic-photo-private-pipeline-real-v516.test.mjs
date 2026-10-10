/**
 * INTEGRAÇÃO REAL num runner: PostgreSQL 17 + Sharp/FS + clamd verdadeiro
 * com assinatura LOCAL INOFENSIVA, sem atualização na CDN.
 * Autoridade única V5.16: cidadao-ai/index.html #trafficForm/submitTrafficForm
 * e shared/jeriflow-audit-citizen.js evidence().
 * ZIP SHA-256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 *
 * NÃO comprova operação contínua com assinaturas oficiais no VPS.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync,existsSync} from "node:fs";
import {mkdtemp,mkdir,writeFile,readdir,rm} from "node:fs/promises";
import {tmpdir,userInfo} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import sharp from "sharp";
import pg from "pg";
import {TrafficPhotoPrivatePipelineV516} from "../../apps/api/src/traffic-photo-private-pipeline-v516.ts";
import {TrafficPhotoOwnershipV516} from "../../apps/api/src/traffic-photo-ownership-v516.ts";
import {TrafficPhotoVerificationWorkerV516} from "../../apps/api/src/traffic-photo-verified-worker-v516.ts";
import {CitizenAccountsV516} from "../../apps/api/src/citizen-accounts-v516.ts";
import {commandClamdV516} from "../../apps/api/src/clamav-daemon-live-v516.ts";
import {TrafficCleanPhotoStoreV516} from "../../apps/api/src/traffic-photo-clean-store-v516.ts";
import {digest} from "../../apps/api/src/identity-primitives.ts";

const ownerDsn=process.env.JF_V516_TEST_OWNER_DSN;
const appDsn=process.env.JF_V516_TEST_APP_DSN;
const workerDsn=process.env.JF_V516_TEST_WORKER_DSN;
if(!ownerDsn||!appDsn||!workerDsn)throw Error("EPHEMERAL_POSTGRES_REQUIRED");
const sha=x=>createHash("sha256").update(x).digest("hex");
const md5=x=>createHash("md5").update(x).digest("hex");
const by=code=>e=>e?.code===code;
const mid=randomUUID();
function photo(color){
 return sharp({create:{width:580,height:310,channels:3,background:color}})
   .png().toBuffer();
}
async function startDaemon(root,infectedWebP){
 const db=join(root,"definitions"),socket=join(root,"clamd.sock"),conf=join(root,"clamd.conf");
 await mkdir(db,{mode:0o700});
 await writeFile(join(db,"local-test.hdb"),
  md5(infectedWebP)+":"+infectedWebP.length+":Win.Test.JeriFlow-V516-LocalOnly\n",
  {mode:0o600});
 const account=userInfo().username;
 assert.match(account,/^[a-z_][a-z0-9_-]*$/i);
 await writeFile(conf,[
  "DatabaseDirectory "+db,"LocalSocket "+socket,"LocalSocketMode 600",
  "StreamMaxLength 16M","ReadTimeout 20","CommandReadTimeout 15",
  "MaxThreads 2","MaxQueue 4","User "+account,""
 ].join("\n"),{mode:0o600});
 const bin=existsSync("/usr/sbin/clamd")?"/usr/sbin/clamd":"clamd";
 const daemon=spawn(bin,["--foreground","--config-file="+conf],
  {stdio:["ignore","pipe","pipe"],shell:false});
 let logs="",launchError;
 const track=part=>{logs=(logs+part.toString()).slice(-3500);};
 daemon.stdout.on("data",track);
 daemon.stderr.on("data",track);
 daemon.on("error",e=>launchError=e);
 for(let n=0;n<160;n++){
  if(launchError||daemon.exitCode!==null)break;
  try{if(await commandClamdV516(socket,"PING",500)==="PONG")
    return {daemon,socket};}
  catch{}
  await delay(250);
 }
 daemon.kill("SIGTERM");
 throw Error("CLAMD_LOCAL_DID_NOT_START "+String(launchError?.message??logs));
}
async function shutdown(p){
 if(!p||p.exitCode!==null)return;
 const exited=new Promise(ok=>p.once("exit",ok));
 p.kill("SIGTERM");
 await Promise.race([exited,delay(3000)]);
 if(p.exitCode===null)p.kill("SIGKILL");
}
test("V5.16: foto QUARENTENA → posse PG → clamd REAL → gate → protocolo ÚNICO",
 {timeout:200000},async t=>{
 const root=await mkdtemp(join(tmpdir(),"jf516-full-private-"));
 const raw=await mkdtemp(join(tmpdir(),"jf516-full-raw-"));
 const clean=await mkdtemp(join(tmpdir(),"jf516-full-clean-"));
 const owner=new pg.Client({connectionString:ownerDsn});
 const app=new pg.Client({connectionString:appDsn});
 const account=new CitizenAccountsV516(appDsn);
 const possession=new TrafficPhotoOwnershipV516(appDsn);
 let worker,daemon;
 try{
  await owner.connect();
  await owner.query(
   "CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-jeriflow-test-only'");
  await owner.query("CREATE SCHEMA app");
  await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
  for(const file of ["001-identity.sql","002-identity-security.sql","003-account-management.sql",
   "004-citizen-v516.sql","005-citizen-v516-traffic-protocol.sql",
   "006-citizen-v516-scanned-photo-worker.sql","007-citizen-v516-traffic-photo-owner.sql"]){
   await owner.query(readFileSync(new URL("../../infra/migrations/"+file,import.meta.url),"utf8"));
  }
  await owner.query(
   "CREATE ROLE jeriflow_scan_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-scan-test-only'");
  await owner.query("GRANT jeriflow_v516_scan_worker TO jeriflow_scan_test");
  await owner.query(
   "INSERT INTO app.municipalities(id,slug,display_name) VALUES($1,'pipeline-test-local','Município fictício')",[mid]);
  await app.connect();

  const a=await account.signup({municipalityId:mid,name:"Cidadão Fictício A",
   birthDate:"1991-02-03",phone:"(88) 90000-0000",address:"Rua Teste",
   login:"pipeline.a",password:"SenhaFicticia123",confirmPassword:"SenhaFicticia123"});
  const b=await account.signup({municipalityId:mid,name:"Cidadão Fictício B",
   birthDate:"1992-03-04",phone:"(88) 91111-1111",address:"Avenida Teste",
   login:"pipeline.b",password:"SenhaFicticia123",confirmPassword:"SenhaFicticia123"});

  const safe=await photo("#80d3ce");
  const marked=await photo("#e098a0");
  const flaggedWebP=await sharp(marked,{failOn:"error",limitInputPixels:80000000,
    animated:false,pages:1}).rotate().resize({width:1200,withoutEnlargement:true})
    .webp({quality:70,effort:4,lossless:false}).toBuffer();
  daemon=await startDaemon(root,flaggedWebP);
  worker=await TrafficPhotoVerificationWorkerV516.openPrivate({
   photoRoot:clean,clamdSocketPath:daemon.socket,workerDatabaseUrl:workerDsn
  });
  // Usar código REAL do worker/PG e clamd local. A fase 14 prova assinatura
  // OFICIAL no mesmo runner; aqui uma hdb inofensiva evita novo download.
  const pipeline=await TrafficPhotoPrivatePipelineV516.openPrivate({
   quarantineDirectory:raw,cleanPhotoRoot:clean,ownership:possession,worker
  });
  const count=async()=>Number((await owner.query(
   "SELECT count(*)::int AS n FROM app.citizen_v516_traffic_protocols")).rows[0].n);
  const submit=(tokenHash,photoId,photoSha)=>app.query(
   "SELECT app.citizen_v516_traffic_submit($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12) AS protocol",
   [mid,tokenHash,null,"","","","Estacionamento irregular","Rua Fictícia",
    "ABC1234","Veículo estacionado irregularmente no teste",
    photoId,photoSha]);

  let receipt;
  await t.test("quarentena, Sharp, posse PG e clamd REAL registram foto limpa",async()=>{
   receipt=await pipeline.receiveRegistered({
    municipalityId:mid,sessionToken:a.accessToken,bytes:safe,suppliedMime:"image/png"
   });
   assert.equal(receipt.registeredForProtocol,true);
   assert.equal(receipt.evidenceApproved,false);
   assert.equal(receipt.protocolCreated,false);
   assert.equal(receipt.publicUrl,null);
   assert.deepEqual(await readdir(raw),[]);
   const stored=await TrafficCleanPhotoStoreV516.openPrivate(clean);
   const bytes=await stored.readPrivate(mid,receipt.photoId);
   const meta=await sharp(bytes).metadata();
   assert.equal(meta.format,"webp");
   assert(!meta.exif&&!meta.xmp&&!meta.icc);
   const gate=await owner.query(
    "SELECT * FROM app.citizen_v516_verified_traffic_media WHERE photo_id=$1",
    [receipt.photoId]);
   assert.equal(gate.rowCount,1);
   assert.equal(gate.rows[0].sha256,receipt.sha256);
   assert.equal(gate.rows[0].consumed_by,null);
   assert.equal(await count(),0);
  });
  await t.test("segunda conta não usa foto alheia apesar de saber UUID e SHA",async()=>{
   await assert.rejects(submit(digest(b.accessToken),receipt.photoId,receipt.sha256),
    by("JF004"));
   assert.equal(await count(),0);
  });
  await t.test("conta correta emite UM protocolo original para SEMUS/Guarda",async()=>{
   const p=await submit(digest(a.accessToken),receipt.photoId,receipt.sha256);
   const id=p.rows[0].protocol;
   assert.match(id,/^JF-[0-9]{8}-[0-9]{6,}$/);
   const r=(await owner.query(
    "SELECT * FROM app.citizen_v516_traffic_protocols WHERE id=$1",[id])).rows[0];
   assert.equal(r.category,"Trânsito (SEMUS)");
   assert.equal(r.destination,"SEMUS / Guarda de trânsito");
   assert.equal(r.status,"RECEBIDA");
   assert.equal(r.has_photo,true);
   assert.equal(r.photo_id,receipt.photoId);
   assert.equal(await count(),1);
   await assert.rejects(submit(digest(a.accessToken),receipt.photoId,receipt.sha256),
    by("JF004"));
  });
  await t.test("clamd REAL bloqueia a foto sintética sinalizada e não cria protocolo",async()=>{
   await assert.rejects(pipeline.receiveRegistered({
    municipalityId:mid,sessionToken:a.accessToken,bytes:marked,suppliedMime:"image/png"
   }),by("MALWARE_DETECTED"));
   assert.deepEqual(await readdir(raw),[]);
   assert.equal(await count(),1);
   const gate=await owner.query(
    "SELECT count(*)::int AS n FROM app.citizen_v516_verified_traffic_media");
   assert.equal(gate.rows[0].n,1);
  });
 }finally{
  await worker?.close().catch(()=>{});
  await possession.close().catch(()=>{});
  await account.close().catch(()=>{});
  await app.end().catch(()=>{});
  await owner.end().catch(()=>{});
  await shutdown(daemon?.daemon);
  await rm(raw,{recursive:true,force:true});
  await rm(clean,{recursive:true,force:true});
  await rm(root,{recursive:true,force:true});
 }
});
