import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {mkdtemp,chmod,lstat,readdir,readFile,writeFile,symlink,rm,utimes} from "node:fs/promises";
import {TrafficPhotoQuarantineV516} from "../apps/api/src/traffic-photo-quarantine.ts";
import {TRAFFIC_PHOTO_MAX_BYTES} from "../apps/api/src/traffic-photo-candidate.ts";

const jpeg=()=>{
 const data=Buffer.alloc(64);data.set([255,216,255,224,0,16,74,70,73,70],0);
 data.set([255,217],data.length-2);return data;
};
async function privateSpace(fn) {
 const root=await mkdtemp(join(tmpdir(),"jf-v516-private-"));
 try { await fn(root); }
 finally {await rm(root,{recursive:true,force:true});}
}

test("V5.16: dir privado 0700 é pré-requisito e não permite base inexistente",async()=>{
 await assert.rejects(TrafficPhotoQuarantineV516.openPrivate("/pasta_inexistente_jeriflow_v516_"+randomUUID()),
  e=>e.code==="PRIVATE_STORAGE_REQUIRED");
 await privateSpace(async root=>{
  const stat=await lstat(root);
  assert.equal(stat.mode&0o077,0);
  assert(await TrafficPhotoQuarantineV516.openPrivate(root));
  await chmod(root,0o755);
  await assert.rejects(TrafficPhotoQuarantineV516.openPrivate(root),
   e=>e.code==="PRIVATE_STORAGE_REQUIRED");
 });
});
test("V5.16: não segue symlink configurado como diretório",async()=>{
 await privateSpace(async root=>{
  const link=root+"-link";
  try{
   await symlink(root,link,"dir");
   await assert.rejects(TrafficPhotoQuarantineV516.openPrivate(link),
    e=>e.code==="PRIVATE_STORAGE_REQUIRED");
  }finally{await rm(link,{force:true});}
 });
});
test("V5.16: grava quarentena privada com nome aleatório, 0600 e sem URL",async()=>{
 await privateSpace(async root=>{
  const service=await TrafficPhotoQuarantineV516.openPrivate(root);
  const data=jpeg(),t=await service.stage(data,"image/jpeg");
  assert.equal(t.state,"quarantined_unverified");
  assert.deepEqual([t.imageDecoded,t.metadataRemoved,t.malwareScanned,t.evidenceApproved,t.protocolCreated],
   [false,false,false,false,false]);
  assert(Object.isFrozen(t));
  assert.match(t.id,/^[a-f0-9-]{36}$/);
  for(const k of ["path","url","publicUrl","receipt","protocolId","paymentRegistered","paidUntil"])
   assert.equal(Object.hasOwn(t,k),false,k);
  const names=await readdir(root);
  assert.deepEqual(names,[t.id+".quarantine"]);
  const file=join(root,names[0]);
  const stat=await lstat(file);
  assert.equal(stat.mode&0o077,0);
  assert.equal(stat.mode&0o600,0o600);
  assert.equal(stat.nlink,1);
  assert.deepEqual(await readFile(file),data);
  assert.deepEqual(await service.readUntrustedForProcessor(t.id),data);
 });
});
test("V5.16: duplicidade de foto nunca deduz protocolo nem reutiliza ID",async()=>{
 await privateSpace(async root=>{
  const service=await TrafficPhotoQuarantineV516.openPrivate(root);
  const a=await service.stage(jpeg()),b=await service.stage(jpeg());
  assert.notEqual(a.id,b.id);
  assert.equal(a.sha256,b.sha256);
  assert.equal((await readdir(root)).length,2);
  assert.equal(a.protocolCreated,false);
  assert.equal(b.protocolCreated,false);
 });
});
test("V5.16: descarte remove apenas seu arquivo, sem tocar outros",async()=>{
 await privateSpace(async root=>{
  const service=await TrafficPhotoQuarantineV516.openPrivate(root);
  const a=await service.stage(jpeg()),b=await service.stage(jpeg());
  await service.discard(a.id);
  assert.deepEqual(await readdir(root),[b.id+".quarantine"]);
  await assert.rejects(service.readUntrustedForProcessor(a.id),
   e=>e.code==="INVALID_QUARANTINE_ID");
  assert.deepEqual(await service.readUntrustedForProcessor(b.id),jpeg());
  await assert.rejects(service.discard(a.id),e=>e.code==="INVALID_QUARANTINE_ID");
 });
});
test("V5.16: não permite traversal de arquivo nem ler UUID desconhecido",async()=>{
 await privateSpace(async root=>{
  const service=await TrafficPhotoQuarantineV516.openPrivate(root);
  for(const id of ["../secrets","/etc/passwd","id.txt",randomUUID(),".",""]){
   await assert.rejects(service.readUntrustedForProcessor(id),
    e=>e.code==="INVALID_QUARANTINE_ID");
   await assert.rejects(service.discard(id),e=>e.code==="INVALID_QUARANTINE_ID");
  }
 });
});
test("V5.16: bytes mudados por terceiro são detectados por hash",async()=>{
 await privateSpace(async root=>{
  const service=await TrafficPhotoQuarantineV516.openPrivate(root);
  const t=await service.stage(jpeg());
  const altered=jpeg();altered[27]=0x11;
  await writeFile(join(root,t.id+".quarantine"),altered,{mode:0o600});
  await assert.rejects(service.readUntrustedForProcessor(t.id),
   e=>e.code==="PRIVATE_STORAGE_REQUIRED");
 });
});
test("V5.16: tamanho máximo do ZIP HTML é 8 MiB também na quarentena",async()=>{
 await privateSpace(async root=>{
  const service=await TrafficPhotoQuarantineV516.openPrivate(root);
  assert.equal(TRAFFIC_PHOTO_MAX_BYTES,8*1024*1024);
  const tooBig=Buffer.alloc(TRAFFIC_PHOTO_MAX_BYTES+1);
  tooBig.set([255,216,255,224,0,16,74,70,73,70],0);
  tooBig.set([255,217],tooBig.length-2);
  await assert.rejects(service.stage(tooBig,"image/jpeg"),e=>e.code==="PHOTO_TOO_LARGE");
  assert.equal((await readdir(root)).length,0);
 });
});
test("V5.16: arquivo disfarçado rejeitado não deixa fragmento na quarentena",async()=>{
 await privateSpace(async root=>{
  const service=await TrafficPhotoQuarantineV516.openPrivate(root);
  await assert.rejects(service.stage(Buffer.from("<svg onload='alert(1)'></svg>"),"image/jpeg"));
  assert.equal((await readdir(root)).length,0);
 });
});
test("V5.16: não apagar amostra ativa durante varredura de órfãos",async()=>{
 await privateSpace(async root=>{
  const service=await TrafficPhotoQuarantineV516.openPrivate(root);
  const keep=await service.stage(jpeg());
  const file=join(root,keep.id+".quarantine");
  const earlier=new Date(Date.now()-7*86400000);
  await utimes(file,earlier,earlier);
  assert.equal(await service.removeExpiredOrphans(86400000),0);
  assert.deepEqual(await service.readUntrustedForProcessor(keep.id),jpeg());
  // Após reiniciar o processo o ticket fica órfão, apto à limpeza controlada.
  const restarted=await TrafficPhotoQuarantineV516.openPrivate(root);
  assert.equal(await restarted.removeExpiredOrphans(86400000),1);
  assert.deepEqual(await readdir(root),[]);
 });
});
test("V5.16: padrão de limpeza nunca remove outro arquivo do diretório",async()=>{
 await privateSpace(async root=>{
  const file=join(root,"LEIA-ME");
  await writeFile(file,"não tocar",{mode:0o600});
  const restarted=await TrafficPhotoQuarantineV516.openPrivate(root);
  assert.equal(await restarted.removeExpiredOrphans(1),0);
  assert.equal((await readFile(file,"utf8")),"não tocar");
 });
});
test("V5.16: duração inválida da limpeza não apaga nada",async()=>{
 await privateSpace(async root=>{
  const service=await TrafficPhotoQuarantineV516.openPrivate(root);
  await assert.rejects(service.removeExpiredOrphans(0));
  await assert.rejects(service.removeExpiredOrphans(-100));
  await assert.rejects(service.removeExpiredOrphans(Infinity));
 });
});
