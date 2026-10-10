import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {createApp} from "../apps/api/src/server.ts";

const municipalityId="733c6075-bd63-48f8-b2a9-f21250e238df";
const otherMunicipalityId="84d0d70a-a449-487a-9413-584b6a212f7c";
const bearer="s".repeat(43);
const image=await sharp({create:{width:44,height:32,channels:3,background:"#abcdef"}})
 .png().toBuffer();
function resolver(token,mid){
  if(token!==bearer||mid!==municipalityId)return Promise.resolve(null);
  return Promise.resolve({municipalityId,citizenId:"CID-000001",name:"Pessoa Fictícia",
    birthDate:"1992-01-02",phone:"00000000000",address:"Rua fictícia",
    login:"pessoa.teste",active:true,blocked:false});
}
async function serverWith(deps,fn){
  const server=createApp(undefined,undefined,deps);
  await new Promise((ok,fail)=>server.once("error",fail).listen(0,"127.0.0.1",ok));
  const address=server.address();
  assert(address&&typeof address!=="string");
  const root="http://127.0.0.1:"+address.port;
  try{await fn(root);}
  finally{await new Promise(done=>server.close(done));}
}
function headers(extra={}){
  return {authorization:"Bearer "+bearer,
    "x-jeriflow-municipality-id":municipalityId,
    "content-type":"image/png",...extra};
}
function options(bytes=image,extra={},method="POST"){
  return {method,headers:headers(extra),body:bytes};
}
async function checkedResponse(root,opts){
  const response=await fetch(root+"/api/v1/citizen/traffic/photo",opts);
  return {status:response.status,body:await response.json(),headers:response.headers};
}
test("V5.16 HTTP: rota não é habilitada por padrão nem em createApp normal",async()=>{
 await serverWith(undefined,async root=>{
  const r=await checkedResponse(root,options());
  assert.equal(r.status,503);
  assert.equal(r.body.error,"NOT_IMPLEMENTED");
 });
});
test("V5.16 HTTP: exige POST e informa Allow",async()=>{
 await serverWith({resolveSession:resolver,ingestVerifiedPhoto:async()=>{}},async root=>{
  const response=await fetch(root+"/api/v1/citizen/traffic/photo",{method:"GET"});
  assert.equal(response.status,405);
  assert.equal(response.headers.get("allow"),"POST");
 });
});
test("V5.16 HTTP: exige sessão real; spoof de identidade não serve",async()=>{
 let accepted=0;
 await serverWith({resolveSession:resolver,ingestVerifiedPhoto:async()=>{accepted++;}},async root=>{
  const r=await checkedResponse(root,{
   method:"POST",
   headers:{"content-type":"image/png","x-jeriflow-municipality-id":municipalityId,
     "x-registered":"true","x-citizen-id":"CID-000001","x-malware-scanned":"true"},
   body:image,
  });
  assert.equal(r.status,401);
  assert.equal(r.body.error,"TRAFFIC_PHOTO_SESSION_REQUIRED");
  assert.equal(accepted,0);
 });
});
test("V5.16 HTTP: token correto em outro município não dá acesso",async()=>{
 let accepted=0;
 await serverWith({resolveSession:resolver,ingestVerifiedPhoto:async()=>{accepted++;}},async root=>{
  const r=await checkedResponse(root,options(image,{
    "x-jeriflow-municipality-id":otherMunicipalityId}));
  assert.equal(r.status,403);
  assert.equal(accepted,0);
 });
});
test("V5.16 HTTP: moderação bloqueada é rejeitada no servidor",async()=>{
 let accepted=0;
 await serverWith({
  resolveSession:async(token,mid)=>({...await resolver(token,mid),blocked:true}),
  ingestVerifiedPhoto:async()=>{accepted++;}
 },async root=>{
  const r=await checkedResponse(root,options());
  assert.equal(r.status,403);
  assert.equal(accepted,0);
 });
});
test("V5.16 HTTP: recusa JSON, multipart e Content-Encoding para foto",async()=>{
 await serverWith({resolveSession:resolver,ingestVerifiedPhoto:async()=>{throw Error("not-called");}},
 async root=>{
   for(const extras of [{"content-type":"application/json"},
     {"content-type":"multipart/form-data; boundary=dummy"},
     {"content-encoding":"gzip"}]){
     const r=await checkedResponse(root,options(image,extras));
     assert.equal(r.status,415);
   }
 });
});
test("V5.16 HTTP: ignora alegação MIME; checa assinatura real da foto",async()=>{
 let accepted=0;
 await serverWith({resolveSession:resolver,ingestVerifiedPhoto:async()=>{accepted++;}},
 async root=>{
  const r=await checkedResponse(root,options(image,{"content-type":"image/jpeg"}));
  assert.equal(r.status,422);
  assert.equal(r.body.error,"TRAFFIC_PHOTO_INVALID");
  assert.equal(accepted,0);
 });
});
test("V5.16 HTTP: corpo inválido nunca aciona armazenador",async()=>{
 let accepted=0;
 await serverWith({resolveSession:resolver,ingestVerifiedPhoto:async()=>{accepted++;}},
 async root=>{
  const r=await checkedResponse(root,options(Buffer.from("imagem inválida"),{}));
  assert.equal(r.status,400);
  assert.equal(accepted,0);
 });
});
test("V5.16 HTTP: acima de 8 MiB é rejeitado ANTES de pipeline",async()=>{
 let accepted=0;
 await serverWith({resolveSession:resolver,ingestVerifiedPhoto:async()=>{accepted++;}},
 async root=>{
  const oversized=Buffer.alloc(8*1024*1024+1,65);
  const r=await checkedResponse(root,options(oversized));
  assert.equal(r.status,413);
  assert.equal(accepted,0);
 });
});
test("V5.16 HTTP: sessão validada, imagem válida, contexto vem somente do servidor",async()=>{
 let seen;
 await serverWith({resolveSession:resolver,
  ingestVerifiedPhoto:async(input)=>{seen=input;}
 },async root=>{
  const r=await checkedResponse(root,options(image,{
    "x-evidence-approved":"true","x-protocol-created":"true",
    "x-citizen-id":"CID-FORGED","x-photo-url":"https://example.invalid/public",
  }));
  assert.equal(r.status,202);
  assert.deepEqual(r.body,{status:"PHOTO_RECEIVED",evidenceApproved:false,
    protocolCreated:false,publicUrl:null});
  assert.equal(Object.hasOwn(r.body,"photoId"),false);
  assert.equal(Object.hasOwn(r.body,"sha256"),false);
  assert.deepEqual(seen.context,{municipalityId,citizenId:"CID-000001"});
  assert.equal(seen.suppliedMime,"image/png");
  assert.deepEqual(seen.bytes,image);
 });
});
test("V5.16 HTTP: dependência privada falha fechado sem protocolo",async()=>{
 await serverWith({resolveSession:resolver,
  ingestVerifiedPhoto:async()=>{throw new Error("scanner offline");}
 },async root=>{
  const r=await checkedResponse(root,options());
  assert.equal(r.status,503);
  assert.equal(r.body.error,"TRAFFIC_PHOTO_UNAVAILABLE");
  assert(!("photoId" in r.body));
 });
});
