import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,rm,readdir,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import sharp from "sharp";
import {createApp} from "../apps/api/src/server.ts";
import {
 TrafficPhotoPrivatePipelineV516,createPrivateTrafficPhotoHttpAdapterV516
} from "../apps/api/src/traffic-photo-private-pipeline-v516.ts";

const MID="a713fb8f-7de1-4cbc-ad79-80acaccdb910";
const TOKEN=randomBytes(32).toString("base64url");
const ORIGINAL=await sharp({create:{
 width:1420,height:840,channels:3,background:"#d69a4f"
}}).jpeg({quality:90}).withExif({IFD0:{Copyright:"synthetic-test-exif"}}).toBuffer();
const simple=await sharp({create:{
 width:240,height:160,channels:3,background:"#97cdaa"
}}).png().toBuffer();
async function fixture(handler){
 const q=await mkdtemp(join(tmpdir(),"jf516-raw-"));
 const store=await mkdtemp(join(tmpdir(),"jf516-clean-"));
 let reservations=[],scans=[];
 const deps={
  ownership:{async reserveRegistered(x){reservations.push(x);}},
  worker:{async verifyAndRegister(t){
   scans.push(t);
   return {...t,malwareScanned:true,malwareFound:false,
     registeredForProtocol:true,evidenceApproved:false,protocolCreated:false,publicUrl:null};
  }}
 };
 const create=()=>TrafficPhotoPrivatePipelineV516.openPrivate({
  quarantineDirectory:q,cleanPhotoRoot:store,
  ownership:deps.ownership,worker:deps.worker
 });
 try{await handler({q,store,reservations,scans,deps,create});}
 finally{
  await rm(q,{recursive:true,force:true});
  await rm(store,{recursive:true,force:true});
 }
}
test("V5.16 pipeline: fotografia bruta vira WebP 1200px sem EXIF, passa pelo gate",async()=>{
 await fixture(async({q,store,reservations,scans,create})=>{
  const p=await create();
  const result=await p.receiveRegistered({
   municipalityId:MID,sessionToken:TOKEN,bytes:ORIGINAL,suppliedMime:"image/jpeg"
  });
  assert.equal(result.registeredForProtocol,true);
  assert.equal(result.protocolCreated,false);
  assert.equal(result.evidenceApproved,false);
  assert.equal(result.publicUrl,null);
  assert.deepEqual(await readdir(q),[],"nenhuma imagem bruta sobrevive");
  assert.equal(scans.length,1);
  assert.equal(reservations.length,1);
  assert.equal(reservations[0].sessionToken,TOKEN);
  assert.equal(reservations[0].municipalityId,MID);
  assert.equal(reservations[0].ticket.photoId,result.photoId);
  assert.equal(reservations[0].ticket.sha256,result.sha256);
  const webp=await sharp(join(store,MID,result.photoId+".webp")).metadata();
  assert.equal(webp.format,"webp");
  assert(webp.width<=1200);
  assert.equal(webp.exif,undefined);
  assert.equal(webp.xmp,undefined);
  assert.equal(webp.icc,undefined);
  const mode=(await stat(join(store,MID,result.photoId+".webp"))).mode;
  assert.equal(mode&0o077,0,"foto privada não acessível a outros usuários");
 });
});
test("V5.16 pipeline: arquivo inventado bloqueado antes de qualquer escrita",async()=>{
 await fixture(async({q,store,reservations,scans,create})=>{
  const p=await create();
  await assert.rejects(p.receiveRegistered({
   municipalityId:MID,sessionToken:TOKEN,bytes:Buffer.from("não é imagem"),suppliedMime:"image/png"
  }),e=>e.code==="TRAFFIC_PHOTO_PIPELINE_INVALID");
  assert.deepEqual(await readdir(q),[]);
  assert.deepEqual(await readdir(store),[]);
  assert.equal(reservations.length,0);assert.equal(scans.length,0);
 });
});
test("V5.16 pipeline: Bearer inválido não faz scan nem escreve disco",async()=>{
 await fixture(async({q,store,create,reservations,scans})=>{
  const p=await create();
  await assert.rejects(p.receiveRegistered({
   municipalityId:MID,sessionToken:"spoof-token",bytes:simple,suppliedMime:"image/png"
  }),e=>e.code==="TRAFFIC_PHOTO_PIPELINE_INVALID");
  assert.deepEqual(await readdir(q),[]);
  assert.deepEqual(await readdir(store),[]);
  assert.equal(reservations.length,0);assert.equal(scans.length,0);
 });
});
test("V5.16 pipeline: falha de reserva elimina arquivo bruto e imagem ainda sem titular",async()=>{
 await fixture(async({q,store,deps,create})=>{
  deps.ownership.reserveRegistered=async()=>{throw new Error("SESSION_REVOKED");};
  const p=await create();
  await assert.rejects(p.receiveRegistered({
   municipalityId:MID,sessionToken:TOKEN,bytes:simple,suppliedMime:"image/png"
  }),/SESSION_REVOKED/);
  assert.deepEqual(await readdir(q),[]);
  const tenant=await readdir(join(store,MID));
  assert.deepEqual(tenant,[]);
 });
});
test("V5.16 pipeline: scanner indisponível NÃO retorna recibo, nem cria protocolo",async()=>{
 await fixture(async({q,store,deps,reservations,create})=>{
  deps.worker.verifyAndRegister=async()=>{throw new Error("SCAN_UNAVAILABLE");};
  const p=await create();
  await assert.rejects(p.receiveRegistered({
   municipalityId:MID,sessionToken:TOKEN,bytes:simple,suppliedMime:"image/png"
  }),/SCAN_UNAVAILABLE/);
  assert.deepEqual(await readdir(q),[]);
  assert.equal(reservations.length,1,"reserva anterior é exigida");
  assert.equal((await readdir(join(store,MID))).length,2,
   "arquivo reservado fica privado para reconciliação segura; não é publicado");
 });
});
test("V5.16 pipeline: resposta forjada de worker não vira foto aprovada",async()=>{
 await fixture(async({deps,create})=>{
  deps.worker.verifyAndRegister=async t=>({...t,registeredForProtocol:true,
   malwareScanned:false,evidenceApproved:false,protocolCreated:false,publicUrl:null});
  const p=await create();
  await assert.rejects(p.receiveRegistered({
   municipalityId:MID,sessionToken:TOKEN,bytes:simple,suppliedMime:"image/png"
  }),e=>e.code==="TRAFFIC_PHOTO_PIPELINE_UNAVAILABLE");
 });
});
test("V5.16 pipeline: sem diretório privado recusa inicialização",async()=>{
 await fixture(async({q,store,deps})=>{
  await assert.rejects(TrafficPhotoPrivatePipelineV516.openPrivate({
   quarantineDirectory:join(q,"inexistente"),cleanPhotoRoot:store,
   ownership:deps.ownership,worker:deps.worker
  }),e=>e.code==="PRIVATE_STORAGE_REQUIRED");
 });
});
test("V5.16 HTTP opt-in: token não aparece na resposta e ingressa no pipeline",async()=>{
 await fixture(async({q,store,create,scans})=>{
  const pipeline=await create();
  const adapter=createPrivateTrafficPhotoHttpAdapterV516({
   pipeline,
   resolveSession:async (token,mid)=>token===TOKEN&&mid===MID ? ({
     municipalityId:MID,citizenId:"CID-00000001",name:"Cidadão Fictício",
     birthDate:"1991-10-01",phone:"000000000",address:"Lugar Fictício",
     login:"cid.teste",active:true,blocked:false
   }):null
  });
  const app=createApp(undefined,undefined,adapter);
  await new Promise((ok,bad)=>app.once("error",bad).listen(0,"127.0.0.1",ok));
  try{
   const addr=app.address();assert(addr&&typeof addr!=="string");
   const res=await fetch("http://127.0.0.1:"+addr.port+"/api/v1/citizen/traffic/photo",{
    method:"POST",
    headers:{authorization:"Bearer "+TOKEN,"x-jeriflow-municipality-id":MID,
     "content-type":"image/png","x-registered":"true","x-photo-url":"https://fake.invalid"},
    body:simple
   });
   assert.equal(res.status,202);
   const text=await res.text();
   const obj=JSON.parse(text);
   assert.deepEqual(obj,{status:"PHOTO_RECEIVED",protocolCreated:false,
    evidenceApproved:false,publicUrl:null});
   assert(!text.includes(TOKEN));
   assert(!text.includes("CID-00000001"));
   assert(!text.includes("photoId"));
   assert.equal(scans.length,1);
   assert.deepEqual(await readdir(q),[]);
   assert.equal((await readdir(join(store,MID))).length,2);
  }finally{await new Promise(done=>app.close(done));}
 });
});
