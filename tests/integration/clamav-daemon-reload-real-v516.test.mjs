/**
 * Testa RELOAD de um CLAMD VERDADEIRO sem usar bases oficiais/CDN.
 * Duas imagens WEBP criadas localmente. A assinatura local .hdb é INOFENSIVA.
 * NÃO é certificação das bases oficiais, que a PR #27 verifica separadamente.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir,userInfo} from "node:os";
import {setTimeout as pause} from "node:timers/promises";
import sharp from "sharp";
import {commandClamdV516} from "../../apps/api/src/clamav-daemon-live-v516.ts";
import {scanStoredTrafficPhotoV516} from "../../apps/api/src/traffic-photo-malware-v516.ts";

const hash=(b)=>createHash("sha256").update(b).digest("hex");
const hdb=(b,name)=>createHash("md5").update(b).digest("hex")+":"+b.length+":"+name+"\n";
const mid="e98f9478-1130-470a-9b30-24a2ef34e55c",photo="fafda71b-2c65-44b1-bc13-86bacbad3e2f";
function receipt(bytes){return {municipalityId:mid,photoId:photo,sha256:hash(bytes),
  byteLength:bytes.length,stored:true,normalized:true,metadataRemoved:true,malwareScanned:false,
  evidenceApproved:false,protocolCreated:false,publicUrl:null};}
async function scan(bytes,socketPath){
 return scanStoredTrafficPhotoV516({readPrivate:async()=>bytes},receipt(bytes),socketPath,3000);
}
test("V5.16: daemon verdadeiro carrega assinatura nova somente após RELOAD",{timeout:110_000},async t=>{
 const root=await mkdtemp(join(tmpdir(),"jf516-reload-real-")),db=join(root,"db"),
   socket=join(root,"clamd.sock");
 let child;
 try{
  await mkdir(db,{mode:0o700});
  const a=await sharp({create:{width:40,height:40,channels:3,background:"#eec090"}}).webp({quality:70}).toBuffer();
  const b=await sharp({create:{width:40,height:40,channels:3,background:"#9beebb"}}).webp({quality:70}).toBuffer();
  await writeFile(join(db,"first.hdb"),hdb(a,"Win.Test.JeriFlow.InitialSignature"),{mode:0o600});
  const conf=join(root,"clamd.conf"),user=userInfo().username;
  assert.match(user,/^[a-z_][a-z0-9_-]*$/i);
  await writeFile(conf,[
    "DatabaseDirectory "+db,
    "LocalSocket "+socket,
    "LocalSocketMode 600",
    "StreamMaxLength 16M",
    "ReadTimeout 10",
    "CommandReadTimeout 10",
    "MaxThreads 2",
    "User "+user,
    "EnableReloadCommand yes",
    ""
  ].join("\n"),{mode:0o600});
  const bin=existsSync("/usr/sbin/clamd")?"/usr/sbin/clamd":"clamd";
  child=spawn(bin,["--foreground","--config-file="+conf],{stdio:["ignore","pipe","pipe"],shell:false});
  let output="",spawnError;
  child.on("error",e=>spawnError=e);
  child.stderr.on("data",d=>{output=(output+d.toString()).slice(-5000);});
  child.stdout.on("data",d=>{output=(output+d.toString()).slice(-5000);});
  let alive=false;
  for(let attempt=0;attempt<100;attempt++){
    if(spawnError||child.exitCode!==null)break;
    try{if(await commandClamdV516(socket,"PING",500)==="PONG"){alive=true;break;}}
    catch{}
    await pause(200);
  }
  assert(alive,"clamd precisa iniciar: "+String(spawnError?.message??output).slice(-1500));
  await t.test("antes da alteração, a primeira foto é identificada",async()=>{
    await assert.rejects(scan(a,socket),e=>e?.code==="MALWARE_DETECTED");
  });
  await t.test("antes de RELOAD, a segunda foto é limpa",async()=>{
    const s=await scan(b,socket);
    assert.equal(s.malwareScanned,true);
    assert.equal(s.evidenceApproved,false);
  });
  await writeFile(join(db,"second.hdb"),hdb(b,"Win.Test.JeriFlow.AfterReload"),{mode:0o600});
  await t.test("RELOAD confirmado por daemon real, não por stub",async()=>{
    assert.equal(await commandClamdV516(socket,"RELOAD",5000),"RELOADING");
  });
  await t.test("após RELOAD, o daemon passa a detectar a segunda foto",async()=>{
    let detected=false;
    for(let attempt=0;attempt<60;attempt++){
      try{await scan(b,socket);}
      catch(e){if(e?.code==="MALWARE_DETECTED"){detected=true;break;}
        if(e?.code!=="SCAN_UNAVAILABLE"&&e?.code!=="SCAN_UNVERIFIED")throw e;}
      await pause(350);
    }
    assert(detected,"RELOAD não disponibilizou assinatura adicionada");
    assert.equal(await commandClamdV516(socket,"PING"),"PONG");
  });
 }finally{
  if(child&&child.exitCode===null){
    const exited=new Promise(ok=>child.once("exit",ok));
    child.kill("SIGTERM");
    await Promise.race([exited,pause(3000)]);
    if(child.exitCode===null)child.kill("SIGKILL");
  }
  await rm(root,{recursive:true,force:true});
 }
});
