import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {createServer} from "node:net";
import pg from "pg";
import sharp from "sharp";
import {TrafficCleanPhotoStoreV516} from "../../apps/api/src/traffic-photo-clean-store-v516.ts";
import {TrafficPhotoVerificationWorkerV516} from "../../apps/api/src/traffic-photo-verified-worker-v516.ts";

const ownerDsn=process.env.JF_V516_TEST_OWNER_DSN;
const appDsn=process.env.JF_V516_TEST_APP_DSN;
const workerDsn=process.env.JF_V516_TEST_WORKER_DSN;
if(!ownerDsn||!appDsn||!workerDsn)throw Error("EPHEMERAL_TEST_DATABASE_REQUIRED");
const sha=x=>createHash("sha256").update(x).digest("hex");
const error=code=>e=>e?.code===code;
async function daemon(root,reply,run,callback){
 const socketPath=join(root,"clamd-"+randomUUID()+".sock");
 let scannedBytes=null;
 const server=createServer({allowHalfOpen:true},socket=>{
  const chunks=[];
  socket.on("data",v=>chunks.push(v));
  socket.on("end",()=>{
   const input=Buffer.concat(chunks),prefix=Buffer.from("zINSTREAM\0");
   assert.deepEqual(input.subarray(0,prefix.length),prefix);
   let offset=prefix.length,received=[];
   while(offset<input.length){
    const len=input.readUInt32BE(offset);offset+=4;
    if(!len)break;
    assert(len<=65536);received.push(input.subarray(offset,offset+len));offset+=len;
   }
   assert.equal(offset,input.length);
   scannedBytes=Buffer.concat(received);
   socket.end(Buffer.from(reply));
  });
 });
 await new Promise((ok,fail)=>server.once("error",fail).listen(socketPath,ok));
 try{return await run(socketPath,()=>scannedBytes);}
 finally{await new Promise(ok=>server.close(ok));}
}
test("V5.16: somente worker privado de mídia varrida alimenta gate de protocolo PostgreSQL",{
 timeout:120_000},async t=>{
 const root=await mkdtemp(join(tmpdir(),"jf516-worker-")),owner=new pg.Client({connectionString:ownerDsn}),
    app=new pg.Client({connectionString:appDsn}),
    restrictedWorker=new pg.Client({connectionString:workerDsn});
 let worker;
 try{
  await owner.connect();
  await owner.query("CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-jeriflow-test-only'");
  await owner.query("CREATE SCHEMA app");
  await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
  for(const file of ["001-identity.sql","002-identity-security.sql","003-account-management.sql",
    "004-citizen-v516.sql","005-citizen-v516-traffic-protocol.sql",
    "006-citizen-v516-scanned-photo-worker.sql"]){
   await owner.query(readFileSync(new URL("../../infra/migrations/"+file,import.meta.url),"utf8"));
  }
  await owner.query("CREATE ROLE jeriflow_scan_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-scan-test-only'");
  await owner.query("GRANT jeriflow_v516_scan_worker TO jeriflow_scan_test");
  await app.connect();await restrictedWorker.connect();
  const mid=randomUUID();
  await owner.query("INSERT INTO app.municipalities(id,slug,display_name) VALUES($1,'city-for-scan','Município Fictício')",[mid]);
  const store=await TrafficCleanPhotoStoreV516.openPrivate(root);
  const bytes=await sharp({create:{width:64,height:48,channels:3,background:"#e1d4aa"}})
    .webp({quality:70}).toBuffer();
  const meta=await sharp(bytes).metadata();
  const normalized={
    bytes,sha256:sha(bytes),originalSha256:sha("imagem origem fictícia"),
    byteLength:bytes.length,width:meta.width,height:meta.height,mime:"image/webp",
    maxWidthFromV516:1200,qualityFromV516:70,sourceMime:"image/png",
    imageDecoded:true,metadataRemoved:true,stored:false,malwareScanned:false,
    evidenceApproved:false,protocolCreated:false
  };
  const ticket=await store.store(mid,normalized);
  const count=async()=>(await owner.query(
    "SELECT count(*)::int AS n FROM app.citizen_v516_verified_traffic_media")).rows[0].n;

  await t.test("role HTTP não insere gate nem chama sua função reservada",async()=>{
   await assert.rejects(app.query(
     "SELECT app.citizen_v516_record_scanned_media($1,$2,$3)",
     [mid,ticket.photoId,ticket.sha256]),error("42501"));
   await assert.rejects(app.query(
     "INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",
     [ticket.photoId,mid,ticket.sha256]),error("42501"));
   assert.equal(await count(),0);
  });
  await t.test("role scanner não pode ler PII/protocolos ou inserir evidência diretamente",async()=>{
   await assert.rejects(restrictedWorker.query(
     "SELECT * FROM app.citizen_v516_accounts"),error("42501"));
   await assert.rejects(restrictedWorker.query(
     "SELECT * FROM app.citizen_v516_traffic_protocols"),error("42501"));
   await assert.rejects(restrictedWorker.query(
     "INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",
     [randomUUID(),mid,sha("no")]),error("42501"));
  });
  await t.test("sem worker real o gate permanece vazio",async()=>{
   assert.equal(await count(),0);
  });
  await t.test("credencial HTTP ou admin é recusada ANTES da varredura",async()=>{
   for(const dsn of [appDsn,ownerDsn]){
    const rejected=await TrafficPhotoVerificationWorkerV516.openPrivate(
     {photoRoot:root,clamdSocketPath:"/not-running.sock",workerDatabaseUrl:dsn});
    try{await assert.rejects(rejected.verifyAndRegister(ticket),
      error("PHOTO_WORKER_ROLE_DENIED"));}
    finally{await rejected.close();}
   }
   assert.equal(await count(),0);
  });
  await t.test("sem resposta do clamd falha fechado e não escreve gate",async()=>{
   worker=await TrafficPhotoVerificationWorkerV516.openPrivate({
    photoRoot:root,clamdSocketPath:join(root,"inexistent.sock"),workerDatabaseUrl:workerDsn});
   await assert.rejects(worker.verifyAndRegister(ticket),error("SCAN_UNAVAILABLE"));
   await worker.close();worker=null;
   assert.equal(await count(),0);
  });
  await t.test("clamd informa malware: zero fotografias autorizadas no gate",async()=>{
   await daemon(root,"stream: Eicar-Test-Signature FOUND\0",async socket=>{
    const scan=await TrafficPhotoVerificationWorkerV516.openPrivate(
      {photoRoot:root,clamdSocketPath:socket,workerDatabaseUrl:workerDsn});
    try{await assert.rejects(scan.verifyAndRegister(ticket),error("MALWARE_DETECTED"));}
    finally{await scan.close();}
   });
   assert.equal(await count(),0);
  });
  await t.test("clamd limpo com bytes corretos registra APENAS a elegibilidade da foto",async()=>{
   await daemon(root,"stream: OK\0",async(socket,received)=>{
    const scan=await TrafficPhotoVerificationWorkerV516.openPrivate(
     {photoRoot:root,clamdSocketPath:socket,workerDatabaseUrl:workerDsn});
    try{
     const approvedForProtocol=await scan.verifyAndRegister(ticket);
     assert.deepEqual(received(),bytes);
     assert.equal(approvedForProtocol.registeredForProtocol,true);
     assert.equal(approvedForProtocol.malwareScanned,true);
     assert.equal(approvedForProtocol.evidenceApproved,false);
     assert.equal(approvedForProtocol.protocolCreated,false);
     assert.equal(approvedForProtocol.publicUrl,null);
    }finally{await scan.close();}
   });
   assert.equal(await count(),1);
   const row=(await owner.query("SELECT * FROM app.citizen_v516_verified_traffic_media")).rows[0];
   assert.equal(row.municipality_id,mid);
   assert.equal(row.photo_id,ticket.photoId);
   assert.equal(row.sha256,ticket.sha256);
   assert.equal(row.consumed_by,null);
   assert.equal((await owner.query(
     "SELECT count(*)::int AS n FROM app.citizen_v516_traffic_protocols")).rows[0].n,0);
  });
  await t.test("revarrer uma foto não duplica entrada canônica",async()=>{
   await daemon(root,"stream: OK\0",async socket=>{
    const scan=await TrafficPhotoVerificationWorkerV516.openPrivate(
     {photoRoot:root,clamdSocketPath:socket,workerDatabaseUrl:workerDsn});
    try{await assert.rejects(scan.verifyAndRegister(ticket),
      error("PHOTO_WORKER_DB_UNAVAILABLE"));}
    finally{await scan.close();}
   });
   assert.equal(await count(),1);
  });
  await t.test("SHA falso é recusado antes de incluir mídia no banco",async()=>{
   const another=await store.store(mid,normalized);
   await assert.rejects(
     (async()=>{const scan=await TrafficPhotoVerificationWorkerV516.openPrivate(
      {photoRoot:root,clamdSocketPath:"/not-running.sock",workerDatabaseUrl:workerDsn});
      try{await scan.verifyAndRegister({...another,sha256:"0".repeat(64)});}
      finally{await scan.close();}})(),error("PHOTO_INTEGRITY_FAILURE"));
   assert.equal(await count(),1);
  });
 }finally{
  await worker?.close().catch(()=>{});
  await restrictedWorker.end().catch(()=>{});
  await app.end().catch(()=>{});
  await owner.end().catch(()=>{});
  await rm(root,{recursive:true,force:true});
 }
});
