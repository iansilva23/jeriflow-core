import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {examineTrafficPhotoCandidate,TRAFFIC_PHOTO_MAX_BYTES} from "../apps/api/src/traffic-photo-candidate.ts";

function jpeg(){
 const b=Buffer.alloc(64);b.set([255,216,255,224,0,16,74,70,73,70],0);b.set([255,217],62);return b;
}
function png(){
 const b=Buffer.alloc(57);b.set([137,80,78,71,13,10,26,10],0);
 b.writeUInt32BE(13,8);b.write("IHDR",12);b.writeUInt32BE(640,16);b.writeUInt32BE(480,20);
 b.writeUInt32BE(0,45);b.write("IEND",49);return b;
}
function webp(){
 const b=Buffer.alloc(32);b.write("RIFF",0);b.writeUInt32LE(24,4);
 b.write("WEBP",8);b.write("VP8X",12);return b;
}
function gif(){
 const b=Buffer.alloc(20);b.write("GIF89a",0);b.writeUInt16LE(320,6);
 b.writeUInt16LE(240,8);b[19]=0x3b;return b;
}
function bmff(brand){
 const b=Buffer.alloc(40);b.writeUInt32BE(24,0);b.write("ftyp",4);b.write(brand,8);return b;
}
const formats=[
 ["JPEG","image/jpeg",jpeg],["PNG","image/png",png],["WebP","image/webp",webp],
 ["GIF","image/gif",gif],["HEIC iOS","image/heic",()=>bmff("heic")],
 ["HEIF iOS","image/heif",()=>bmff("mif1")],
 ["AVIF","image/avif",()=>bmff("avif")],
];
for(const [name,mime,make] of formats){
 test("V5.16: foto candidata de câmera/galeria — "+name,()=>{
  const b=make();
  const result=examineTrafficPhotoCandidate(b,mime);
  assert.equal(result.mime,mime);
  assert.equal(result.sha256,createHash("sha256").update(b).digest("hex"));
  assert.equal(result.byteLength,b.length);
  assert.deepEqual([result.trust,result.stored,result.scanned,result.metadataRemoved,result.protocolCreated],
   ["untrusted",false,false,false,false]);
  assert(Object.isFrozen(result));
 });
}
test("V5.16: ausência de MIME do dispositivo usa detecção por assinatura",()=>{
 assert.equal(examineTrafficPhotoCandidate(jpeg()).mime,"image/jpeg");
 assert.equal(examineTrafficPhotoCandidate(bmff("heic"),"image/heif").mime,"image/heic");
 assert.equal(examineTrafficPhotoCandidate(jpeg(),"image/jpg").mime,"image/jpeg");
});
test("V5.16: imagem falsa não passa por extensão ou MIME declarado",()=>{
 for(const b of [Buffer.from("foto.jpg"),Buffer.alloc(128),Buffer.from("<svg>"+'x'.repeat(300)+"</svg>"),
  Buffer.from("%PDF"+'x'.repeat(200)),Buffer.from("<script>"+'x'.repeat(100))]){
  assert.throws(()=>examineTrafficPhotoCandidate(b,"image/jpeg"));
 }
});
test("V5.16: MIME diferente da assinatura não passa",()=>{
 assert.throws(()=>examineTrafficPhotoCandidate(png(),"image/jpeg"),
  x=>x?.code==="PHOTO_MIME_MISMATCH");
 assert.throws(()=>examineTrafficPhotoCandidate(gif(),"image/png"),
  x=>x?.code==="PHOTO_MIME_MISMATCH");
 assert.throws(()=>examineTrafficPhotoCandidate(jpeg(),"image/svg+xml"),
  x=>x?.code==="UNSUPPORTED_PHOTO_FORMAT");
});
test("V5.16: arquivos acima do limite técnico de upload são recusados",()=>{
 assert.throws(()=>examineTrafficPhotoCandidate(Buffer.alloc(TRAFFIC_PHOTO_MAX_BYTES+1)),
  x=>x?.code==="PHOTO_TOO_LARGE");
});
test("V5.16: JPEG truncado e PNG sem IEND não viram evidência",()=>{
 const a=jpeg();a[63]=0;
 assert.throws(()=>examineTrafficPhotoCandidate(a));
 const b=png();b.write("BAD!",49);
 assert.throws(()=>examineTrafficPhotoCandidate(b));
});
test("V5.16: dimensões 0 e declaração RIFF inconsistente são recusadas",()=>{
 const p=png();p.writeUInt32BE(0,16);
 assert.throws(()=>examineTrafficPhotoCandidate(p));
 const w=webp();w.writeUInt32LE(600,4);
 assert.throws(()=>examineTrafficPhotoCandidate(w));
});
test("V5.16: ISO BMFF sem marca de foto é rejeitado",()=>{
 assert.throws(()=>examineTrafficPhotoCandidate(bmff("mp42")));
});
test("V5.16: sem bytes ou com tipo de parâmetro incorreto falha antes de usar arquivo",()=>{
 for(const b of [undefined,null,{},[],true,"base64-falso"]){
  assert.throws(()=>examineTrafficPhotoCandidate(b));
 }
 assert.throws(()=>examineTrafficPhotoCandidate(jpeg(),{mime:"image/jpeg"}));
});
test("V5.16: nenhum resultado concede recibo, pagamento, quitação ou protocolo",()=>{
 for(const [,mime,make] of formats){
  const result=examineTrafficPhotoCandidate(make(),mime);
  for(const key of ["protocolId","uploaded","approved","paymentRegistered","paidUntil",
                    "clean","cleanUrl","publicUrl","guardOccurrenceId"]){
   assert.equal(Object.hasOwn(result,key),false,key);
  }
 }
});
