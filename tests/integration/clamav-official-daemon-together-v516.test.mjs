/**
 * Etapa 14 — CI COM BASES OFICIAIS e daemon REAL no MESMO runner descartável.
 * Referência UX: JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_* SHA-256
 * 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * cidadao-ai/index.html #trafficForm, shared/jeriflow-audit-citizen.js evidence().
 *
 * ESTE TESTE NÃO DEVE rodar contra VPS e não usa fotos de cidadãos reais.
 * Use apenas em CI autorizado, após FreshClam terminar sem falhas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {createConnection} from "node:net";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir,userInfo} from "node:os";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import sharp from "sharp";
import {
  commandClamdV516,assertClamdLoadsOfficialDailyV516,
  reloadClamdAndVerifyV516
} from "../../apps/api/src/clamav-daemon-live-v516.ts";
import {checkOfficialClamAVDatabasesV516} from "../../apps/api/src/clamav-official-readiness-v516.ts";
import {scanStoredTrafficPhotoV516} from "../../apps/api/src/traffic-photo-malware-v516.ts";

const dir=process.env.JF_V516_OFFICIAL_CLAMAV_DB;
if(!dir||!dir.startsWith("/"))throw new Error("ISOLATED_CI_OFFICIAL_DB_REQUIRED");
const sha256=b=>createHash("sha256").update(b).digest("hex");
const md5=b=>createHash("md5").update(b).digest("hex");
const mid="47b0c7f3-49a5-4902-b5c6-2f3d279c6408";
const photoId="f9f2e620-2a54-4fc6-a449-1d87f7ea3f86";
const ticket=bytes=>({
 municipalityId:mid,photoId,sha256:sha256(bytes),byteLength:bytes.length,
 stored:true,normalized:true,metadataRemoved:true,malwareScanned:false,
 evidenceApproved:false,protocolCreated:false,publicUrl:null
});
async function scanWebP(bytes,socketPath){
 return scanStoredTrafficPhotoV516(
  {readPrivate:async()=>bytes},ticket(bytes),socketPath,12000);
}
async function scanViaInstream(socketPath,bytes){
 return await new Promise((resolve,reject)=>{
  const socket=createConnection({path:socketPath});
  let buf=Buffer.alloc(0),settled=false;
  const end=(err,result)=>{
   if(settled)return;settled=true;socket.destroy();
   err?reject(err):resolve(result);
  };
  socket.setTimeout(12000);
  socket.on("error",end);
  socket.on("timeout",()=>end(new Error("INSTREAM_TIMEOUT")));
  socket.on("end",()=>end(new Error("INSTREAM_REPLY_MISSING")));
  socket.on("connect",()=>{
   socket.write(Buffer.from("zINSTREAM\0"));
   for(let offset=0;offset<bytes.length;offset+=65536){
    const chunk=bytes.subarray(offset,Math.min(offset+65536,bytes.length));
    const len=Buffer.alloc(4);len.writeUInt32BE(chunk.length);
    socket.write(len);socket.write(chunk);
   }
   socket.end(Buffer.alloc(4));
  });
  socket.on("data",chunk=>{
   buf=Buffer.concat([buf,chunk]);
   if(buf.length>2048)return end(new Error("INSTREAM_REPLY_OVERSIZE"));
   const marker=buf.indexOf(0);
   if(marker>=0){
    if(marker!==buf.length-1)return end(new Error("INSTREAM_REPLY_EXTRA"));
    end(undefined,buf.subarray(0,marker).toString("utf8"));
   }
  });
 });
}
async function startClamd(dbDir,root){
 const socket=join(root,"clamd.sock"),config=join(root,"clamd.conf");
 const user=userInfo().username;
 assert.match(user,/^[a-z_][a-z0-9_-]*$/i);
 await writeFile(config,[
  "DatabaseDirectory "+dbDir,
  "LocalSocket "+socket,
  "LocalSocketMode 600",
  "StreamMaxLength 16M",
  "ReadTimeout 25",
  "CommandReadTimeout 20",
  "MaxThreads 2",
  "MaxQueue 4",
  "EnableReloadCommand yes",
  "EnableVersionCommand yes",
  "User "+user,""
 ].join("\n"),{mode:0o600});
 const daemon=spawn("/usr/sbin/clamd",["--foreground","--config-file="+config],{
  stdio:["ignore","pipe","pipe"],shell:false
 });
 let output="",spawnError;
 const save=d=>{output=(output+d.toString()).slice(-3500);};
 daemon.stdout.on("data",save);daemon.stderr.on("data",save);
 daemon.on("error",e=>{spawnError=e;});
 for(let n=0;n<200;n++){
  if(spawnError||daemon.exitCode!==null)break;
  try{
   if(await commandClamdV516(socket,"PING",500)==="PONG")
     return {daemon,socket,log:()=>output};
  }catch{}
  await delay(350);
 }
 daemon.kill("SIGTERM");
 throw new Error("REAL_CLAMD_OFFICIAL_START_FAILURE "+String(spawnError?.message??output));
}
async function shutdown(proc){
 if(!proc||proc.exitCode!==null)return;
 const exited=new Promise(done=>proc.once("exit",done));
 proc.kill("SIGTERM");
 await Promise.race([exited,delay(3500)]);
 if(proc.exitCode===null)proc.kill("SIGKILL");
}
test("V5.16: FreshClam oficial + clamd com MESMAS bases + recarga real em 1 runner",
 {timeout:210000},async t=>{
 const root=await mkdtemp(join(tmpdir(),"jf516-official-clamd-together-"));
 let started;
 try{
  const proof=await checkOfficialClamAVDatabasesV516(dir);
  assert.equal(proof.databases.length,3);
  assert(proof.dailyWithin72Hours);
  await t.test("main, daily e bytecode assinadas e daily atual",()=>{
   assert.deepEqual(proof.databases.map(x=>x.kind),["main","daily","bytecode"]);
   assert(proof.databases.every(x=>x.verified));
   assert.equal(proof.evidenceApproved,false);
   assert.equal(proof.protocolCreated,false);
  });
  started=await startClamd(dir,root);
  const {socket}=started;
  await t.test("clamd verdadeiro responde PING no socket privado",async()=>{
   assert.equal(await commandClamdV516(socket,"PING"),"PONG");
  });
  await t.test("VERSION corresponde à daily OFICIAL assinada",async()=>{
   const result=await assertClamdLoadsOfficialDailyV516({
     socketPath:socket,databaseDirectory:dir
   });
   assert(result.dailyVersion>0);
   assert.equal(result.daemonVerified,true);
   assert.equal(result.evidenceApproved,false);
  });
  await t.test("a assinatura EICAR inofensiva na base real é detectada",async()=>{
   // Conteúdo oficial de TESTE EICAR: texto, NÃO malware nem upload.
   const sample=Buffer.from(
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    "ascii");
   const response=await scanViaInstream(socket,sample);
   assert.match(response,/^stream: .+ FOUND$/);
  });
  const clean=await sharp({
   create:{width:64,height:48,channels:3,background:"#a5dcb5"}
  }).webp({quality:70}).toBuffer();
  const flagged=await sharp({
   create:{width:64,height:48,channels:3,background:"#f2b88f"}
  }).webp({quality:70}).toBuffer();
  assert(!clean.equals(flagged));
  await t.test("foto WebP sintética limpa passa sem protocolo",async()=>{
   const verdict=await scanWebP(clean,socket);
   assert.equal(verdict.malwareScanned,true);
   assert.equal(verdict.evidenceApproved,false);
   assert.equal(verdict.protocolCreated,false);
   assert.equal(verdict.publicUrl,null);
  });
  await t.test("antes da recarga, outra foto sintética está limpa",async()=>{
   const verdict=await scanWebP(flagged,socket);
   assert.equal(verdict.malwareFound,false);
  });
  // A assinatura adicional é LOCAL, de um WebP inofensivo. As CVDs
  // oficiais ficam intocadas. Confere recarga MESMO sem mudar daily version.
  await writeFile(join(dir,"jeri-v516-test-once.hdb"),
   md5(flagged)+":"+flagged.length+":Win.Test.JeriFlow-ReloadInOfficialDB\n",
   {mode:0o644});
  await t.test("RELOAD de bases oficiais é aceito pelo daemon real",async()=>{
   const result=await reloadClamdAndVerifyV516({
     socketPath:socket,databaseDirectory:dir
   },50,200);
   assert(result.dailyVersion>0);
  });
  await t.test("depois de recarga real, WebP novo é BLOQUEADO",async()=>{
   let found=false;
   for(let n=0;n<80;n++){
    try{await scanWebP(flagged,socket);}
    catch(e){
     if(e?.code==="MALWARE_DETECTED"){found=true;break;}
     if(!["SCAN_UNAVAILABLE","SCAN_UNVERIFIED"].includes(e?.code))throw e;
    }
    await delay(300);
   }
   assert(found,"assinatura local adicionada não ficou ativa após RELOAD");
   const signed=await assertClamdLoadsOfficialDailyV516({
    socketPath:socket,databaseDirectory:dir
   });
   assert.equal(signed.daemonVerified,true);
  });
  await t.test("foto limpa continua limpa, sem denúncia nem exposição pública",async()=>{
   const verdict=await scanWebP(clean,socket);
   assert.equal(verdict.evidenceApproved,false);
   assert.equal(verdict.protocolCreated,false);
   assert.equal(verdict.publicUrl,null);
  });
 }finally{
  await shutdown(started?.daemon);
  await rm(join(dir,"jeri-v516-test-once.hdb"),{force:true}).catch(()=>{});
  await rm(root,{recursive:true,force:true});
 }
});
