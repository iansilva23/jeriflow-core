import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID,createDecipheriv,hkdfSync} from "node:crypto";
import {attachmentInput,attachmentListInput,encryptAttachment,MAX_ATTACHMENT_BYTES} from "../apps/api/src/ouvidoria-attachments.ts";
const municipalityId=randomUUID(),protocolId=randomUUID(),clientRequestId=randomUUID();
const data=Buffer.concat([Buffer.from("%PDF-1.7\n","ascii"),Buffer.alloc(90,65)]);
const good={municipalityId,protocolId,clientRequestId,fileName:"evidencia.pdf",
  mediaType:"application/pdf",dataBase64:data.toString("base64")};
test("anexos: política estrita para dados, extensão, mime, tamanho e base64",()=>{
  const v=attachmentInput(good);
  assert.equal(v.sizeBytes,data.length);assert.deepEqual(v.bytes,data);
  assert.deepEqual(attachmentListInput({municipalityId,protocolId}),{municipalityId,protocolId});
  for(const value of [
    {...good,ownerId:randomUUID()},{...good,mediaType:"text/html"},
    {...good,fileName:"../secret.pdf"},{...good,fileName:"arquivo\\nome.pdf"},
    {...good,fileName:"imagem.exe"},{...good,dataBase64:Buffer.from("<html>").toString("base64")},
    {...good,dataBase64:"!bad"},{...good,dataBase64:Buffer.alloc(MAX_ATTACHMENT_BYTES+1).toString("base64")},
    {...good,protocolId:"invalid"}, {...good,fileName:"x".repeat(81)}
  ])assert.throws(()=>attachmentInput(value));
  assert.throws(()=>attachmentListInput({municipalityId,protocolId,force:true}));
});
test("anexos: AES-GCM derivado e autenticado não grava plaintext",()=>{
  const key=randomBytes(32);
  const one=encryptAttachment(key,municipalityId,protocolId,clientRequestId,data);
  const two=encryptAttachment(key,municipalityId,protocolId,clientRequestId,data);
  assert(!one.equals(two));assert(!one.includes(data));
  const derived=Buffer.from(hkdfSync("sha256",key,Buffer.from("jeriflow-attachments-v1"),
    Buffer.from("at-rest-object"),32));
  const dec=createDecipheriv("aes-256-gcm",derived,one.subarray(0,12));
  dec.setAAD(Buffer.from("jeriflow:attachment:v1:"+municipalityId+":"+protocolId+":"+clientRequestId));
  dec.setAuthTag(one.subarray(12,28));
  assert.deepEqual(Buffer.concat([dec.update(one.subarray(28)),dec.final()]),data);
  const wrong=createDecipheriv("aes-256-gcm",derived,one.subarray(0,12));
  wrong.setAAD(Buffer.from("jeriflow:attachment:v1:"+municipalityId+":"+protocolId+":"+randomUUID()));
  wrong.setAuthTag(one.subarray(12,28));
  assert.throws(()=>Buffer.concat([wrong.update(one.subarray(28)),wrong.final()]));
});
