import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {TrafficPhotoQuarantineV516} from "../apps/api/src/traffic-photo-quarantine.ts";
import {normalizeUntrustedTrafficPhotoV516} from "../apps/api/src/traffic-photo-normalize-v516.ts";

async function inPrivateDir(fn){
 const dir=await mkdtemp(join(tmpdir(),"jeriflow-v516-normalize-"));
 try{const quarantine=await TrafficPhotoQuarantineV516.openPrivate(dir);await fn(quarantine)}
 finally{await rm(dir,{recursive:true,force:true})}
}
async function source(width,height,format="jpeg",opts={}){
 let image=sharp({create:{width,height,channels:3,background:{r:174,g:80,b:26}}});
 if(opts.orientation)image=image.withMetadata({orientation:opts.orientation});
 if(opts.exif)image=image.withExif({IFD0:{ImageDescription:"PRIVATE-JERIFLOW-METADATA-MARKER"}});
 if(format==="jpeg")return await image.jpeg({quality:82}).toBuffer();
 if(format==="png")return await image.png().toBuffer();
 if(format==="webp")return await image.webp().toBuffer();
 if(format==="gif")return await image.gif().toBuffer();
 throw Error("unsupported fixture");
}
async function normalize(quarantine,bytes,mime){
 const t=await quarantine.stage(bytes,mime);
 const output=await normalizeUntrustedTrafficPhotoV516(quarantine,t.id,mime);
 return {ticket:t,output};
}
test("V5.16: JPEG de câmera vira WebP sem exposição ou aprovação",async()=>{
 await inPrivateDir(async quarantine=>{
  const original=await source(1700,900,"jpeg");
  const {ticket,output}=await normalize(quarantine,original,"image/jpeg");
  assert.equal(ticket.state,"quarantined_unverified");
  assert.equal(output.mime,"image/webp");
  assert.equal(output.width,1200);
  assert(output.height>0&&output.height<900);
  assert.equal(output.qualityFromV516,70);
  assert.equal(output.maxWidthFromV516,1200);
  assert.equal(output.imageDecoded,true);
  assert.equal(output.metadataRemoved,true);
  assert.deepEqual([output.stored,output.malwareScanned,output.evidenceApproved,output.protocolCreated],
    [false,false,false,false]);
  assert.equal(output.sha256,createHash("sha256").update(output.bytes).digest("hex"));
  assert.equal(output.originalSha256,ticket.sha256);
  assert(!("url" in output));assert(!("protocolId" in output));
 });
});
test("V5.16: PNG pequeno não aumenta artificialmente",async()=>{
 await inPrivateDir(async quarantine=>{
  const original=await source(320,240,"png");
  const {output}=await normalize(quarantine,original,"image/png");
  assert.deepEqual([output.width,output.height],[320,240]);
  assert.equal((await sharp(output.bytes).metadata()).format,"webp");
 });
});
test("V5.16: orientação vertical usa largura máxima, não corta altura",async()=>{
 await inPrivateDir(async quarantine=>{
  const {output}=await normalize(quarantine,await source(600,1700,"jpeg"),"image/jpeg");
  assert.deepEqual([output.width,output.height],[600,1700]);
  assert.equal(output.evidenceApproved,false);
 });
});
test("V5.16: foto PNG com transparência mantém alpha ao converter para WebP",async()=>{
 await inPrivateDir(async quarantine=>{
  const png=await sharp({create:{width:260,height:160,channels:4,
   background:{r:10,g:50,b:100,alpha:0.4}}}).png().toBuffer();
  const {output}=await normalize(quarantine,png,"image/png");
  const clean=await sharp(output.bytes).metadata();
  assert.equal(clean.format,"webp");
  assert.equal(clean.hasAlpha,true);
  assert.equal(output.metadataRemoved,true);
  assert.equal(output.malwareScanned,false);
 });
});
test("V5.16: disfarce de imagem SVG não supera assinatura e decodificador",async()=>{
 await inPrivateDir(async quarantine=>{
  const forged=Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>");
  await assert.rejects(quarantine.stage(forged,"image/png"));
 });
});
test("V5.16: foto com EXIF identificável perde campos e marca textual",async()=>{
 await inPrivateDir(async quarantine=>{
  const original=await source(200,300,"jpeg",{exif:true});
  const old=await sharp(original).metadata();
  assert(old.exif?.length>0,"a fixture precisa conter EXIF real");
  const {output}=await normalize(quarantine,original,"image/jpeg");
  const clean=await sharp(output.bytes).metadata();
  assert.equal(clean.exif,undefined);
  assert.equal(clean.xmp,undefined);
  assert.equal(clean.iptc,undefined);
  assert.equal(clean.icc,undefined);
  assert.equal(clean.orientation,undefined);
  assert.equal(output.bytes.includes(Buffer.from("PRIVATE-JERIFLOW-METADATA-MARKER")),false);
 });
});
test("V5.16: orientação EXIF é aplicada antes de descartar metadados",async()=>{
 await inPrivateDir(async quarantine=>{
  const original=await source(80,140,"jpeg",{orientation:6});
  const metadata=await sharp(original).metadata();
  assert.equal(metadata.orientation,6);
  const {output}=await normalize(quarantine,original,"image/jpeg");
  assert.equal(output.width,140);
  assert.equal(output.height,80);
  assert.equal((await sharp(output.bytes).metadata()).orientation,undefined);
 });
});
test("V5.16: WebP e GIF de galeria são decodificados para WebP comum",async()=>{
 await inPrivateDir(async quarantine=>{
  for(const [mime,format] of [["image/webp","webp"],["image/gif","gif"]]){
   const bytes=await source(480,270,format);
   const {output}=await normalize(quarantine,bytes,mime);
   assert.equal(output.mime,"image/webp");
   assert.equal(output.width,480);
   assert.equal(output.height,270);
  }
 });
});
test("V5.16: cabeçalho de JPEG sintético pode passar a triagem, mas NÃO a decodificação",async()=>{
 await inPrivateDir(async quarantine=>{
  const fake=Buffer.alloc(64);
  fake.set([255,216,255,224,0,16,74,70,73,70],0);
  fake.set([255,217],fake.length-2);
  const ticket=await quarantine.stage(fake,"image/jpeg");
  await assert.rejects(normalizeUntrustedTrafficPhotoV516(quarantine,ticket.id,"image/jpeg"),
   e=>e?.code==="PHOTO_DECODE_FAILED");
 });
});
test("V5.16: arquivo com MIME diferente é recusado mesmo que válido",async()=>{
 await inPrivateDir(async quarantine=>{
  const input=await source(130,90,"jpeg");
  const ticket=await quarantine.stage(input,"image/jpeg");
  await assert.rejects(normalizeUntrustedTrafficPhotoV516(quarantine,ticket.id,"image/png"),
    e=>e?.code==="PHOTO_MIME_MISMATCH");
 });
});
test("V5.16: UUID inexistente não lê imagem nenhuma",async()=>{
 await inPrivateDir(async quarantine=>{
  await assert.rejects(normalizeUntrustedTrafficPhotoV516(quarantine,"00000000-0000-4000-8000-000000000001"),
    e=>e?.code==="INVALID_QUARANTINE_ID");
 });
});
test("V5.16: saída de formato original não é exposta como comprovante ou recibo",async()=>{
 await inPrivateDir(async quarantine=>{
  const {output}=await normalize(quarantine,await source(640,320),"image/jpeg");
  for(const key of ["status","payment","receipt","userId","citizenId","evidenceId",
    "paidUntil","publicUrl","voucherId","guardOccurrenceId"]){
   assert.equal(Object.hasOwn(output,key),false,key);
  }
  assert.equal(output.evidenceApproved,false);
 });
});
