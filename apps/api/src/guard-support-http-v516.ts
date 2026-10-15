/** JeriFlow V5.16 — contrato HTTP isolado dos pedidos de apoio da Guarda.
 * Base: ZIP original SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 * HTML guarda-semus supportModal/supportSend e migração 026; REGISTRO, não despacho.
 * Nenhuma rota ativa sem dependência explícita. A autorização final pertence ao SQL.
 */
import type {IncomingMessage} from "node:http";
import {sessionHash,uuid} from "./identity-primitives.ts";
import {
 GUARD_SUPPORT_REASONS_V516,
 type GuardSupportActorV516,type GuardSupportReasonV516,
 type GuardSupportRecordV516,type GuardSupportAdminItemV516
} from "./guard-support-service-v516.ts";

export const GUARD_SUPPORT_ADMIN_PATH_V516="/api/v1/guarda/apoios";
const SUBMIT=/^\/api\/v1\/guarda\/transito\/(JF-[0-9]{8}-[0-9]{6})\/apoio$/;
export type GuardSupportHttpDependenciesV516=Readonly<{
 submit:(actor:GuardSupportActorV516,protocolId:string,requestId:string,
  reason:GuardSupportReasonV516,note:string)=>Promise<GuardSupportRecordV516>;
 adminQueue:(actor:GuardSupportActorV516,after?:string|null,limit?:number)=>Promise<ReadonlyArray<GuardSupportAdminItemV516>>;
}>;
export class GuardSupportHttpErrorV516 extends Error{
 readonly status:number;readonly code:string;
 constructor(status:number,code:string){super(code);this.status=status;this.code=code;}
}
export function isGuardSupportHttpPathV516(path:string){
 return path===GUARD_SUPPORT_ADMIN_PATH_V516||SUBMIT.test(path);
}
function actor(req:IncomingMessage):GuardSupportActorV516{
 const auth=req.headers.authorization;
 const mid=req.headers["x-jeriflow-municipality-id"];
 const token=typeof auth==="string"?auth.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]:undefined;
 if(!token||typeof mid!=="string")
  throw new GuardSupportHttpErrorV516(401,"GUARD_SUPPORT_SESSION_REQUIRED");
 try{
  const municipalityId=uuid(mid);
  sessionHash(token);
  return {municipalityId,sessionToken:token};
 }catch{throw new GuardSupportHttpErrorV516(401,"GUARD_SUPPORT_SESSION_REQUIRED");}
}
async function json(req:IncomingMessage):Promise<Record<string,unknown>>{
 if(req.headers["content-type"]!=="application/json"&&
    req.headers["content-type"]!=="application/json; charset=utf-8")
  throw new GuardSupportHttpErrorV516(415,"GUARD_SUPPORT_INVALID_BODY");
 if(req.headers["content-encoding"]!==undefined||
    req.headers["transfer-encoding"]!==undefined)
  throw new GuardSupportHttpErrorV516(415,"GUARD_SUPPORT_INVALID_BODY");
 const raw=req.headers["content-length"];
 if(raw!==undefined&&(!/^[0-9]+$/.test(raw)||Number(raw)>4096))
  throw new GuardSupportHttpErrorV516(413,"GUARD_SUPPORT_INVALID_BODY");
 const chunks:Buffer[]=[];let size=0;
 try{
  for await(const part of req){
   const b=Buffer.isBuffer(part)?part:Buffer.from(part);
   size+=b.length;
   if(size>4096)throw new GuardSupportHttpErrorV516(413,"GUARD_SUPPORT_INVALID_BODY");
   chunks.push(b);
  }
 }catch(error){
  if(error instanceof GuardSupportHttpErrorV516)throw error;
  throw new GuardSupportHttpErrorV516(400,"GUARD_SUPPORT_INVALID_BODY");
 }
 if(size<2||(raw!==undefined&&Number(raw)!==size))
  throw new GuardSupportHttpErrorV516(400,"GUARD_SUPPORT_INVALID_BODY");
 let value:unknown;
 try{value=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
 catch{throw new GuardSupportHttpErrorV516(400,"GUARD_SUPPORT_INVALID_BODY");}
 if(!value||typeof value!=="object"||Array.isArray(value))
  throw new GuardSupportHttpErrorV516(400,"GUARD_SUPPORT_INVALID_BODY");
 return value as Record<string,unknown>;
}
export async function handleGuardSupportHttpV516(
 req:IncomingMessage,path:string,deps:GuardSupportHttpDependenciesV516
):Promise<GuardSupportRecordV516|{items:ReadonlyArray<GuardSupportAdminItemV516>}>{
 if(!isGuardSupportHttpPathV516(path))
  throw new GuardSupportHttpErrorV516(404,"GUARD_SUPPORT_NOT_FOUND");
 const user=actor(req);
 if(path===GUARD_SUPPORT_ADMIN_PATH_V516){
  if(req.method!=="GET")throw new GuardSupportHttpErrorV516(405,"GUARD_SUPPORT_METHOD_NOT_ALLOWED");
  const url=new URL(req.url??"/","http://localhost");
  if(url.pathname!==path||url.hash||[...url.searchParams.keys()].some(k=>!["after","limit"].includes(k))||
    ["after","limit"].some(k=>url.searchParams.getAll(k).length>1))
   throw new GuardSupportHttpErrorV516(400,"GUARD_SUPPORT_INVALID_QUERY");
  let after:string|null=null;
  if(url.searchParams.has("after")){
   try{after=uuid(url.searchParams.get("after"));}
   catch{throw new GuardSupportHttpErrorV516(400,"GUARD_SUPPORT_INVALID_QUERY");}
  }
  const rawLimit=url.searchParams.get("limit");
  const limit=rawLimit===null?50:Number(rawLimit);
  if((rawLimit!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit))||
    !Number.isSafeInteger(limit)||limit<1||limit>50)
   throw new GuardSupportHttpErrorV516(400,"GUARD_SUPPORT_INVALID_QUERY");
  return {items:await deps.adminQueue(user,after,limit)};
 }
 if(req.method!=="POST")throw new GuardSupportHttpErrorV516(405,"GUARD_SUPPORT_METHOD_NOT_ALLOWED");
 const match=SUBMIT.exec(path);
 if(!match||req.url!==path)
  throw new GuardSupportHttpErrorV516(400,"GUARD_SUPPORT_INVALID_BODY");
 const data=await json(req);
 if(Object.keys(data).length!==3||
    !["requestId","reason","note"].every(k=>Object.hasOwn(data,k))||
    typeof data.requestId!=="string"||typeof data.reason!=="string"||
    !GUARD_SUPPORT_REASONS_V516.some(v=>v===data.reason)||
    typeof data.note!=="string"||data.note.trim().length>2000||
    /[\u0000-\u0009\u000b-\u001f\u007f]/.test(data.note))
  throw new GuardSupportHttpErrorV516(400,"GUARD_SUPPORT_INVALID_BODY");
 let id:string;
 try{id=uuid(data.requestId);}catch{throw new GuardSupportHttpErrorV516(400,"GUARD_SUPPORT_INVALID_BODY");}
 return deps.submit(user,match[1],id,data.reason as GuardSupportReasonV516,data.note.trim());
}
export function mapGuardSupportHttpErrorV516(error:unknown):GuardSupportHttpErrorV516{
 if(error instanceof GuardSupportHttpErrorV516)return error;
 const code=(error as {code?:unknown}|null)?.code;
 if(code==="JF003")return new GuardSupportHttpErrorV516(403,"GUARD_SUPPORT_DENIED");
 if(code==="JF004")return new GuardSupportHttpErrorV516(404,"GUARD_SUPPORT_NOT_FOUND");
 if(code==="JF001")return new GuardSupportHttpErrorV516(400,"GUARD_SUPPORT_INVALID_BODY");
 if(code==="JF005"||code==="23505")return new GuardSupportHttpErrorV516(409,"GUARD_SUPPORT_CONFLICT");
 return new GuardSupportHttpErrorV516(503,"GUARD_SUPPORT_UNAVAILABLE");
}
