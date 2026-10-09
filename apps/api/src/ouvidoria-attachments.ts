import { createCipheriv, hkdfSync, randomBytes, createHash } from "node:crypto";
import { IdentityError, exactObject, uuid } from "./identity-primitives.ts";

export const MAX_ATTACHMENT_BYTES=1048576;
const maxBase64Length=Math.ceil(MAX_ATTACHMENT_BYTES/3)*4;
const allowed=new Set(["image/jpeg","image/png","application/pdf"]);
export function attachmentListInput(value: unknown) {
  const v=exactObject(value,["municipalityId","protocolId"]);
  if(Object.keys(v).length!==2)throw new IdentityError(400,"INVALID_INPUT");
  return {municipalityId:uuid(v.municipalityId),protocolId:uuid(v.protocolId)};
}
function signature(mediaType:string,bytes:Buffer) {
  if(mediaType==="image/png")return bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"));
  if(mediaType==="image/jpeg")return bytes.subarray(0,3).equals(Buffer.from("ffd8ff","hex"));
  if(mediaType==="application/pdf")return bytes.subarray(0,5).toString("ascii")==="%PDF-";
  return false;
}
export function attachmentInput(value:unknown) {
  const v=exactObject(value,["municipalityId","protocolId","clientRequestId","fileName","mediaType","dataBase64"]);
  if(Object.keys(v).length!==6 || typeof v.fileName!=="string" || typeof v.mediaType!=="string"
    || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(v.fileName)
    || v.fileName.trim()!==v.fileName || v.fileName.includes("..") || !allowed.has(v.mediaType)
    || !(v.mediaType==="image/jpeg" ? /\\.jpe?g$/i.test(v.fileName) :
         v.mediaType==="image/png" ? /\\.png$/i.test(v.fileName) : /\\.pdf$/i.test(v.fileName))
    || typeof v.dataBase64!=="string" || v.dataBase64.length>maxBase64Length
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.dataBase64))
    throw new IdentityError(400,"INVALID_INPUT");
  const bytes=Buffer.from(v.dataBase64,"base64");
  if(bytes.length<32||bytes.length>MAX_ATTACHMENT_BYTES||
    bytes.toString("base64")!==v.dataBase64||!signature(v.mediaType,bytes))throw new IdentityError(400,"INVALID_ATTACHMENT");
  return {municipalityId:uuid(v.municipalityId),protocolId:uuid(v.protocolId),
    clientRequestId:uuid(v.clientRequestId),fileName:v.fileName,
    mediaType:v.mediaType,sizeBytes:bytes.length,bytes,
    sha256:createHash("sha256").update(bytes).digest("hex")};
}
// Derivação separada do segredo de identidade; cada objeto usa AAD distinto.
export function encryptAttachment(key:Buffer,municipalityId:string,protocolId:string,requestId:string,bytes:Buffer) {
  if(key.length!==32)throw new Error("UNAVAILABLE_KEY");
  const derived=Buffer.from(hkdfSync("sha256",key,Buffer.from("jeriflow-attachments-v1"),
    Buffer.from("at-rest-object"),32));
  const nonce=randomBytes(12);
  try{
    const cipher=createCipheriv("aes-256-gcm",derived,nonce);
    cipher.setAAD(Buffer.from("jeriflow:attachment:v1:"+municipalityId+":"+protocolId+":"+requestId));
    const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
    return Buffer.concat([nonce,cipher.getAuthTag(),encrypted]);
  } finally {derived.fill(0);}
}
