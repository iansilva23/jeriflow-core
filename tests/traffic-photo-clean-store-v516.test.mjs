import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {mkdtemp,rm,readdir,readFile,writeFile,chmod,lstat,symlink} from "node:fs/promises";
import sharp from "sharp";
import {TrafficPhotoQuarantineV516} from "../apps/api/src/traffic-photo-quarantine.ts";
import {normalizeUntrustedTrafficPhotoV516} from "../apps/api/src/traffic-photo-normalize-v516.ts";
import {TrafficCleanPhotoStoreV516} from "../apps/api/src/traffic-photo-clean-store-v516.ts";

const midA=randomUUID(),midB=randomUUID();
async function sandbox(fn){
 const base=await mkdtemp(join(tmpdir(),"jeriflow-v516-stored-"));
 const raw=join(base,"quarantine"),clean=join(base,"clean");
 const {mkdir}=await import("node:fs/promises");
 try {
  await mkdir(raw,{mode:0o700});await mkdir(clean,{mode:0o700});
  const quarantine=await TrafficPhotoQuarantineV516.openPrivate(raw);
  const store=await TrafficCleanPhotoStoreV516.openPrivate(clean);
  await fn({raw,clean,quarantine,store});
 }finally{await rm(base,{recursive:true,force:true})}
}
async function normalized(quarantine,exif=false){
 let img=sharp({create:{width:1600,height:900,channels:3,
  background:{r:140,g:190,b:220}}});
 if(exif)img=img.withExif({IFD0:{ImageDescription:"GPS-PRIVATE-DATA-DO-NOT-RETAIN"}});
 const bytes=await img.jpeg({quality:83}).toBuffer();
 const t=await quarantine.stage(bytes,"image/jpeg");
 return normalizeUntrustedTrafficPhotoV516(quarantine,t.id,"image/jpeg");
}
test("V5.16: guarda WebP normalizado em área privada do próprio município",async()=>{
 await sandbox(async({clean,quarantine,store})=>{
  const output=await normalized(quarantine,true);
  const receipt=await store.store(midA,output);
  assert.deepEqual([receipt.stored,receipt.normalized,receipt.metadataRemoved,
    receipt.malwareScanned,receipt.evidenceApproved,receipt.protocolCreated],
    [true,true,true,false,false,false]);
  assert.equal(receipt.publicUrl,null);
  assert.equal(receipt.mime,"image/webp");assert.equal(receipt.width,1200);
  assert(!("name" in receipt)&&!("plate" in receipt)&&!("identity" in receipt));
  assert.deepEqual(await readdir(clean),[midA]);
  const folder=join(clean,midA),files=(await readdir(folder)).sort();
  assert.deepEqual(files,[receipt.photoId+".json",receipt.photoId+".webp"]);
  assert.equal((await lstat(folder)).mode&0o077,0);
  for(const f of files){const stat=await lstat(join(folder,f));assert.equal(stat.mode&0o077,0)}
  const saved=await store.readPrivate(midA,receipt.photoId);
  assert.deepEqual(saved,output.bytes);
  assert.equal((await sharp(saved).metadata()).exif,undefined);
  assert.equal(saved.includes(Buffer.from("GPS-PRIVATE-DATA-DO-NOT-RETAIN")),false);
 });
});
test("V5.16: armazenamento sobrevive ao reinício sem emitir protocolo",async()=>{
 await sandbox(async({clean,quarantine,store})=>{
  const output=await normalized(quarantine);
  const ticket=await store.store(midA,output);
  const restarted=await TrafficCleanPhotoStoreV516.openPrivate(clean);
  assert.deepEqual(await restarted.readPrivate(midA,ticket.photoId),output.bytes);
  assert.equal(ticket.protocolCreated,false);
 });
});
test("V5.16: não é possível acessar mídia de outro município",async()=>{
 await sandbox(async({quarantine,store})=>{
  const photo=await normalized(quarantine);
  const a=await store.store(midA,photo);
  await store.store(midB,photo);
  await assert.rejects(store.readPrivate(midB,a.photoId));
  await assert.rejects(store.discardUnlinked(midB,a.photoId));
  assert.deepEqual(await store.readPrivate(midA,a.photoId),photo.bytes);
 });
});
test("V5.16: trocar bytes por terceiros resulta em falha de integridade",async()=>{
 await sandbox(async({clean,quarantine,store})=>{
  const photo=await normalized(quarantine),saved=await store.store(midA,photo);
  const file=join(clean,midA,saved.photoId+".webp");
  const b=await readFile(file);
  b[Math.floor(b.length/2)]^=0x01;
  await writeFile(file,b);
  await assert.rejects(store.readPrivate(midA,saved.photoId),e=>e?.code==="PHOTO_INTEGRITY_FAILURE");
 });
});
test("V5.16: manifesto alterado não se torna autorização de evidência",async()=>{
 await sandbox(async({clean,quarantine,store})=>{
  const photo=await normalized(quarantine),saved=await store.store(midA,photo);
  const file=join(clean,midA,saved.photoId+".json");
  const data=JSON.parse(await readFile(file,"utf8"));
  data.municipalityId=midB;
  await writeFile(file,JSON.stringify(data));
  await assert.rejects(store.readPrivate(midA,saved.photoId),
   e=>e?.code==="PHOTO_INTEGRITY_FAILURE");
 });
});
test("V5.16: path traversal e UUIDs inválidos bloqueados",async()=>{
 await sandbox(async({quarantine,store})=>{
  const image=await normalized(quarantine);
  for(const id of ["../credenciais","/etc/passwd","",randomUUID().toUpperCase(),"invalid"]){
   await assert.rejects(store.readPrivate(midA,id),e=>e?.code==="INVALID_PHOTO_ID");
   await assert.rejects(store.discardUnlinked(midA,id),e=>e?.code==="INVALID_PHOTO_ID");
  }
  await assert.rejects(store.store("../municipio",image),e=>e?.code==="INVALID_PHOTO_ID");
 });
});
test("V5.16: mídia não normalizada não pode ser guardada como WebP limpo",async()=>{
 await sandbox(async({clean,quarantine,store})=>{
  const good=await normalized(quarantine);
  const fake={...good,bytes:Buffer.from("<svg>not an image</svg>"),
    sha256:"0".repeat(64)};
  await assert.rejects(store.store(midA,fake),e=>e?.code==="PHOTO_NOT_NORMALIZED");
  await assert.rejects(store.store(midA,{...good,malwareScanned:true}),
   e=>e?.code==="PHOTO_NOT_NORMALIZED");
  await assert.rejects(store.store(midA,{...good,bytes:Buffer.from(good.bytes),
    sha256:"0".repeat(64)}),e=>e?.code==="PHOTO_INTEGRITY_FAILURE");
  assert.deepEqual(await readdir(clean),[]);
 });
});
test("V5.16: diretório público ou symlink não serve para evidências",async()=>{
 await sandbox(async({clean,quarantine,store})=>{
  await chmod(clean,0o755);
  await assert.rejects(store.store(midA,await normalized(quarantine)),
   e=>e?.code==="PRIVATE_STORAGE_REQUIRED");
  await chmod(clean,0o700);
  const link=clean+"-link";
  try{
   await symlink(clean,link,"dir");
   await assert.rejects(TrafficCleanPhotoStoreV516.openPrivate(link),
    e=>e?.code==="PRIVATE_STORAGE_REQUIRED");
  }finally{await rm(link,{force:true})}
 });
});
test("V5.16: descarte de amostra sem protocolo não apaga outras mídias",async()=>{
 await sandbox(async({clean,quarantine,store})=>{
  const photo=await normalized(quarantine);
  const first=await store.store(midA,photo),second=await store.store(midA,photo);
  await store.discardUnlinked(midA,first.photoId);
  assert.deepEqual((await readdir(join(clean,midA))).sort(),
   [second.photoId+".json",second.photoId+".webp"]);
  await assert.rejects(store.readPrivate(midA,first.photoId),e=>e?.code==="PHOTO_NOT_FOUND");
  assert.deepEqual(await store.readPrivate(midA,second.photoId),photo.bytes);
 });
});
test("V5.16: recibo interno não é recibo financeiro, voucher ou foto publicada",async()=>{
 await sandbox(async({quarantine,store})=>{
  const photo=await normalized(quarantine);
  const ticket=await store.store(midA,photo);
  for(const k of ["paymentRegistered","paidUntil","voucher","publicUrlString","url",
                   "citizenId","userName","guardOccurrenceId","protocolId"]){
   assert.equal(Object.hasOwn(ticket,k),false,k);
  }
  assert.equal(ticket.malwareScanned,false);
  assert.equal(ticket.evidenceApproved,false);
 });
});
