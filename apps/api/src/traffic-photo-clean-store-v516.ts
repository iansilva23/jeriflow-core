/**
 * Store interno para a FOTO NORMALIZADA da denúncia de trânsito V5.16.
 * Base: cidadao-ai/index.html (trafficForm) e
 * shared/jeriflow-audit-citizen.js evidence()/imageFileToData(file,1200,.7).
 *
 * Não expõe rota, URL, anexo ao protocolo, nem comprova varredura.
 * Cada município tem diretório privado. Nunca aceitar caminhos do cliente.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { NormalizedTrafficPhotoV516 } from "./traffic-photo-normalize-v516.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PERMISSIONS_DIR=0o700,PERMISSIONS_FILE=0o600,MAX_CLEAN_BYTES=8*1024*1024;
const READ_FLAGS=constants.O_RDONLY|constants.O_NOFOLLOW;
const CREATE_FLAGS=constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW;
type Manifest={version:1;municipalityId:string;photoId:string;
  mime:"image/webp";sha256:string;byteLength:number;width:number;height:number};
export type CleanPhotoTicketV516=Readonly<{
  municipalityId:string;photoId:string;sha256:string;byteLength:number;
  mime:"image/webp";width:number;height:number;
  stored:true;normalized:true;metadataRemoved:true;malwareScanned:false;
  evidenceApproved:false;protocolCreated:false;publicUrl:null;
}>;
export class TrafficCleanPhotoError extends Error {
  readonly code:"PRIVATE_STORAGE_REQUIRED"|"INVALID_PHOTO_ID"|"PHOTO_NOT_FOUND"|
    "PHOTO_INTEGRITY_FAILURE"|"PHOTO_NOT_NORMALIZED"|"PHOTO_WRITE_FAILED";
  constructor(code:TrafficCleanPhotoError["code"]){super(code);this.code=code;}
}
function safeUuid(value:unknown):string{
  if(typeof value!=="string"||!UUID.test(value))throw new TrafficCleanPhotoError("INVALID_PHOTO_ID");
  return value;
}
function hash(data:Uint8Array):string{return createHash("sha256").update(data).digest("hex");}
async function privateDir(path:string):Promise<void>{
  let s;try{s=await lstat(path);}catch{throw new TrafficCleanPhotoError("PRIVATE_STORAGE_REQUIRED");}
  if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0)
    throw new TrafficCleanPhotoError("PRIVATE_STORAGE_REQUIRED");
}
async function privateFile(path:string,max:number):Promise<Buffer>{
  let file;
  try{
    file=await open(path,READ_FLAGS);
    const s=await file.stat();
    if(!s.isFile()||s.nlink!==1||(s.mode&0o077)!==0||s.size<1||s.size>max)
      throw new TrafficCleanPhotoError("PHOTO_INTEGRITY_FAILURE");
    return await file.readFile();
  }catch(e){
    if(e instanceof TrafficCleanPhotoError)throw e;
    if((e as NodeJS.ErrnoException).code==="ENOENT")
      throw new TrafficCleanPhotoError("PHOTO_NOT_FOUND");
    throw new TrafficCleanPhotoError("PHOTO_INTEGRITY_FAILURE");
  }finally{await file?.close();}
}
async function writeExclusive(path:string,bytes:Buffer):Promise<void>{
  let file;let created=false;
  try{
    file=await open(path,CREATE_FLAGS,PERMISSIONS_FILE);created=true;
    await file.writeFile(bytes);await file.sync();
  }catch{
    if(file){try{await file.close();}catch{}}
    if(created)try{await unlink(path);}catch{}
    throw new TrafficCleanPhotoError("PHOTO_WRITE_FAILED");
  }finally{if(file)try{await file.close();}catch{}}
}
async function ensureTenantRoot(root:string,mid:string,create:boolean):Promise<string>{
  await privateDir(root);
  const path=join(root,safeUuid(mid));
  if(create)try{await mkdir(path,{mode:PERMISSIONS_DIR});}
    catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw new TrafficCleanPhotoError("PRIVATE_STORAGE_REQUIRED");}
  await privateDir(path);
  return path;
}
async function checkCleanImage(bytes:Buffer):Promise<{width:number;height:number}>{
  if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>MAX_CLEAN_BYTES)
    throw new TrafficCleanPhotoError("PHOTO_NOT_NORMALIZED");
  let meta;
  try{meta=await sharp(bytes,{failOn:"error",limitInputPixels:80_000_000}).metadata();}
  catch{throw new TrafficCleanPhotoError("PHOTO_NOT_NORMALIZED");}
  if(meta.format!=="webp"||!meta.width||!meta.height||
    meta.width>1200||meta.width*meta.height>80_000_000||
    (meta.pages!==undefined&&meta.pages!==1)||
    meta.exif||meta.xmp||meta.icc||meta.iptc||meta.orientation)
    throw new TrafficCleanPhotoError("PHOTO_NOT_NORMALIZED");
  // metadata() só lê o cabeçalho; forçar a decodificação integral antes de persistir
  // ou devolver uma mídia ao futuro processador. Não aceitar WebP truncado/animado.
  try{
    await sharp(bytes,{failOn:"error",limitInputPixels:80_000_000,animated:false,pages:1}).stats();
  }catch{
    throw new TrafficCleanPhotoError("PHOTO_NOT_NORMALIZED");
  }
  return {width:meta.width,height:meta.height};
}
function parseManifest(bytes:Buffer,mid:string,id:string):Manifest{
  let m:Manifest;
  try{m=JSON.parse(bytes.toString("utf8")) as Manifest;}
  catch{throw new TrafficCleanPhotoError("PHOTO_INTEGRITY_FAILURE");}
  if(m.version!==1||m.municipalityId!==mid||m.photoId!==id||
    m.mime!=="image/webp"||!Number.isSafeInteger(m.byteLength)||
    m.byteLength<=0||m.byteLength>MAX_CLEAN_BYTES||
    !Number.isSafeInteger(m.width)||!Number.isSafeInteger(m.height)||
    m.width<=0||m.height<=0||m.width>1200||
    !/^[0-9a-f]{64}$/.test(m.sha256))
    throw new TrafficCleanPhotoError("PHOTO_INTEGRITY_FAILURE");
  return m;
}
export class TrafficCleanPhotoStoreV516 {
  private readonly root:string;
  private constructor(root:string){this.root=root;}
  static async openPrivate(root:string){
    await privateDir(root);
    return new TrafficCleanPhotoStoreV516(root);
  }
  /**
   * Só chamada por código confiável APÓS normalizeUntrustedTrafficPhotoV516().
   * Checamos novamente os bytes; flags booleanas isoladas nunca dão aprovação.
   */
  async store(municipalityId:string,normalized:NormalizedTrafficPhotoV516):Promise<CleanPhotoTicketV516>{
    const mid=safeUuid(municipalityId);
    if(!normalized||normalized.imageDecoded!==true||normalized.metadataRemoved!==true||
      normalized.stored!==false||normalized.malwareScanned!==false||
      normalized.evidenceApproved!==false||normalized.protocolCreated!==false||
      normalized.mime!=="image/webp"||!Buffer.isBuffer(normalized.bytes))
      throw new TrafficCleanPhotoError("PHOTO_NOT_NORMALIZED");
    const meta=await checkCleanImage(normalized.bytes);
    const digest=hash(normalized.bytes);
    if(digest!==normalized.sha256||meta.width!==normalized.width||
       meta.height!==normalized.height)
      throw new TrafficCleanPhotoError("PHOTO_INTEGRITY_FAILURE");
    const folder=await ensureTenantRoot(this.root,mid,true);
    const id=randomUUID(),blob=join(folder,id+".webp"),manifest=join(folder,id+".json");
    const record:Manifest={version:1,municipalityId:mid,photoId:id,
      mime:"image/webp",sha256:digest,byteLength:normalized.bytes.length,
      width:meta.width,height:meta.height};
    await writeExclusive(blob,normalized.bytes);
    try{await writeExclusive(manifest,Buffer.from(JSON.stringify(record),"utf8"));}
    catch(e){await unlink(blob).catch(()=>{});throw e;}
    return Object.freeze({municipalityId:mid,photoId:id,sha256:digest,
      byteLength:record.byteLength,mime:"image/webp",
      width:meta.width,height:meta.height,stored:true,normalized:true,
      metadataRemoved:true,malwareScanned:false,evidenceApproved:false,
      protocolCreated:false,publicUrl:null});
  }
  /**
   * Apenas para futuro worker privado; não expor este Buffer ao navegador.
   * Funciona após reinício do processo porque o manifesto persiste em disco.
   */
  async readPrivate(municipalityId:string,photoId:string):Promise<Buffer>{
    const mid=safeUuid(municipalityId),id=safeUuid(photoId);
    const folder=await ensureTenantRoot(this.root,mid,false);
    const record=parseManifest(await privateFile(join(folder,id+".json"),2048),mid,id);
    const data=await privateFile(join(folder,id+".webp"),MAX_CLEAN_BYTES);
    if(data.length!==record.byteLength||hash(data)!==record.sha256)
      throw new TrafficCleanPhotoError("PHOTO_INTEGRITY_FAILURE");
    const meta=await checkCleanImage(data);
    if(meta.width!==record.width||meta.height!==record.height)
      throw new TrafficCleanPhotoError("PHOTO_INTEGRITY_FAILURE");
    return data;
  }
  /** Usado apenas em cancelamento ou rollback técnico, nunca após protocolo oficial. */
  async discardUnlinked(municipalityId:string,photoId:string):Promise<void>{
    const mid=safeUuid(municipalityId),id=safeUuid(photoId);
    const folder=await ensureTenantRoot(this.root,mid,false);
    // Manifesto precisa existir para impedir operação em ID não reconhecido.
    parseManifest(await privateFile(join(folder,id+".json"),2048),mid,id);
    await unlink(join(folder,id+".json"));
    await unlink(join(folder,id+".webp"));
  }
}
