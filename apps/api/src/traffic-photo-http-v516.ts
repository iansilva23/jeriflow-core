/**
 * Transporte HTTP ISOLADO (desativado por padrão) da foto obrigatória da V5.16.
 *
 * Fonte: cidadao-ai/index.html #trafficForm; shared/jeriflow-audit-citizen.js
 * evidence(file), submitTrafficForm(). ZIP SHA-256
 * 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 *
 * NÃO cria um novo fluxo no aplicativo, não recebe estado/flag do cliente,
 * não inventa aprovação de evidência e não expõe IDs de fotografia.
 * Somente habilitar após identidade, vínculo de propriedade privado, quotas,
 * scanner e protocolo canônico operacionais, inclusive para visitantes.
 */
import type {IncomingMessage} from "node:http";
import {resolveTrafficCitizenIdentityV516, type CitizenSessionResolverV516} from "./traffic-citizen-identity-v516.ts";
import {examineTrafficPhotoCandidate, TrafficPhotoCandidateError, TRAFFIC_PHOTO_MAX_BYTES, type TrafficPhotoMime} from "./traffic-photo-candidate.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const MIME=new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif","image/avif","image/gif"]);
export class TrafficPhotoHttpErrorV516 extends Error {
  readonly status:number;
  readonly code:
    "TRAFFIC_PHOTO_SESSION_REQUIRED"|"TRAFFIC_PHOTO_SESSION_DENIED"|
    "TRAFFIC_PHOTO_CONTENT_TYPE_REQUIRED"|"TRAFFIC_PHOTO_ENCODING_UNSUPPORTED"|
    "TRAFFIC_PHOTO_TOO_LARGE"|"TRAFFIC_PHOTO_INVALID"|
    "TRAFFIC_PHOTO_UNAVAILABLE";
  constructor(status:number,code:TrafficPhotoHttpErrorV516["code"]) {
    super(code);this.status=status;this.code=code;
  }
}
export type TrafficPhotoAcceptedContextV516=Readonly<{
  municipalityId:string;
  citizenId:string;
  // Os dados pessoais não são transmitidos ao app nesta fase.
}>;
export type TrafficPhotoHttpDependenciesV516=Readonly<{
  // Provedor CONFIRMADO pelo backend PostgreSQL, nunca localStorage ou JSON.
  resolveSession:CitizenSessionResolverV516;
  ingestVerifiedPhoto(input:Readonly<{
    context:TrafficPhotoAcceptedContextV516;
    bytes:Buffer;
    suppliedMime:TrafficPhotoMime;
  }>):Promise<void>;
}>;
function header(req:IncomingMessage,name:string):string|null{
  const value=req.headers[name];
  return typeof value==="string"?value:null;
}
async function readImageBounded(req:IncomingMessage):Promise<Buffer>{
  const len=header(req,"content-length");
  if(req.headers["content-length"]!==undefined && (!len||!/^[0-9]+$/.test(len)))
    throw new TrafficPhotoHttpErrorV516(400,"TRAFFIC_PHOTO_INVALID");
  const expected=len===null?null:Number(len);
  if(expected!==null&&(!Number.isSafeInteger(expected)||expected>TRAFFIC_PHOTO_MAX_BYTES))
    throw new TrafficPhotoHttpErrorV516(413,"TRAFFIC_PHOTO_TOO_LARGE");
  if(expected===0)throw new TrafficPhotoHttpErrorV516(400,"TRAFFIC_PHOTO_INVALID");
  const chunks:Buffer[]=[];
  let received=0;
  try{
    for await(const raw of req){
      const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
      received+=chunk.byteLength;
      if(received>TRAFFIC_PHOTO_MAX_BYTES)
        throw new TrafficPhotoHttpErrorV516(413,"TRAFFIC_PHOTO_TOO_LARGE");
      chunks.push(chunk);
    }
  }catch(e){
    if(e instanceof TrafficPhotoHttpErrorV516)throw e;
    throw new TrafficPhotoHttpErrorV516(400,"TRAFFIC_PHOTO_INVALID");
  }
  if(received<20||(expected!==null&&expected!==received))
    throw new TrafficPhotoHttpErrorV516(400,"TRAFFIC_PHOTO_INVALID");
  return Buffer.concat(chunks,received);
}
/**
 * Somente bytes de imagem crus (sem JSON/multipart). É transporte interno,
 * não exige novo controle no formulário original câmera/galeria.
 * A validação das assinaturas e o armazenamento seguro pertencem ao ingest.
 */
export async function acceptRegisteredCitizenTrafficPhotoV516(
  req:IncomingMessage,dependencies:TrafficPhotoHttpDependenciesV516,
):Promise<Readonly<{status:"PHOTO_RECEIVED";protocolCreated:false;
                  evidenceApproved:false;publicUrl:null}>>{
  if(req.headers["content-encoding"]!==undefined)
    throw new TrafficPhotoHttpErrorV516(415,"TRAFFIC_PHOTO_ENCODING_UNSUPPORTED");
  const mimeRaw=header(req,"content-type");
  const mime=mimeRaw?.trim().toLowerCase();
  if(!mime||!MIME.has(mime))
    throw new TrafficPhotoHttpErrorV516(415,"TRAFFIC_PHOTO_CONTENT_TYPE_REQUIRED");
  const auth=header(req,"authorization");
  const mid=header(req,"x-jeriflow-municipality-id");
  const token=auth?.match(/^Bearer ([A-Za-z0-9_-]{40,128})$/)?.[1]??null;
  if(!token||!TOKEN.test(token)||!mid||!UUID.test(mid))
    throw new TrafficPhotoHttpErrorV516(401,"TRAFFIC_PHOTO_SESSION_REQUIRED");
  let identity;
  try{
    identity=await resolveTrafficCitizenIdentityV516(
      {municipalityId:mid,sessionToken:token},dependencies.resolveSession);
  }catch{
    throw new TrafficPhotoHttpErrorV516(403,"TRAFFIC_PHOTO_SESSION_DENIED");
  }
  if(identity.registered!==true||!identity.citizenId)
    throw new TrafficPhotoHttpErrorV516(403,"TRAFFIC_PHOTO_SESSION_DENIED");
  const bytes=await readImageBounded(req);
  try {
    examineTrafficPhotoCandidate(bytes,mime);
    // Dados de usuário nunca são passados diretamente para worker de foto.
    await dependencies.ingestVerifiedPhoto({
      context:{municipalityId:mid,citizenId:identity.citizenId},
      bytes,suppliedMime:mime as TrafficPhotoMime,
    });
  }catch(e){
    if(e instanceof TrafficPhotoCandidateError){
      throw new TrafficPhotoHttpErrorV516(e.code==="PHOTO_TOO_LARGE"?413:422,
        e.code==="PHOTO_TOO_LARGE"?"TRAFFIC_PHOTO_TOO_LARGE":"TRAFFIC_PHOTO_INVALID");
    }
    throw new TrafficPhotoHttpErrorV516(503,"TRAFFIC_PHOTO_UNAVAILABLE");
  }
  return Object.freeze({
    status:"PHOTO_RECEIVED",protocolCreated:false,
    evidenceApproved:false,publicUrl:null,
  });
}
