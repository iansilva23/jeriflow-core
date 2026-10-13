/** Contrato HTTP privado da disponibilidade da Guarda V5.16.
 * Não é ligado em server.ts/main.ts até homologação separada.
 * HTML original: shiftBtn/onShift, ZIP SHA-256
 * 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 */
import type {IncomingMessage} from "node:http";
import {sessionHash,uuid} from "./identity-primitives.ts";
import type {GuardShiftActorV516,GuardShiftStatusV516} from "./guard-shift-service-v516.ts";

export const GUARD_SHIFT_PATH_V516="/api/v1/guarda/plantao";
export type GuardShiftHttpDependenciesV516=Readonly<{
 get:(actor:GuardShiftActorV516)=>Promise<GuardShiftStatusV516>;
 set:(actor:GuardShiftActorV516,id:string,onShift:boolean)=>Promise<GuardShiftStatusV516>;
}>;
export class GuardShiftHttpErrorV516 extends Error{
 constructor(readonly status:number,readonly code:string){super(code);}
}
function bearer(req:IncomingMessage):GuardShiftActorV516{
 const auth=req.headers.authorization;
 const mid=req.headers["x-jeriflow-municipality-id"];
 const token=typeof auth==="string"?auth.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]:undefined;
 if(!token||typeof mid!=="string")throw new GuardShiftHttpErrorV516(401,"GUARD_SHIFT_SESSION_REQUIRED");
 try{uuid(mid);sessionHash(token);}catch{throw new GuardShiftHttpErrorV516(401,"GUARD_SHIFT_SESSION_REQUIRED");}
 return {municipalityId:mid,sessionToken:token};
}
async function json(req:IncomingMessage):Promise<Record<string,unknown>>{
 if(req.headers["content-type"]!=="application/json"&&
    req.headers["content-type"]!=="application/json; charset=utf-8")
  throw new GuardShiftHttpErrorV516(415,"GUARD_SHIFT_INVALID_BODY");
 if(req.headers["content-encoding"]||req.headers["transfer-encoding"])
  throw new GuardShiftHttpErrorV516(415,"GUARD_SHIFT_INVALID_BODY");
 const raw=req.headers["content-length"];
 if(raw!==undefined&&(!/^[0-9]+$/.test(raw)||Number(raw)>256))
  throw new GuardShiftHttpErrorV516(413,"GUARD_SHIFT_INVALID_BODY");
 const chunks:Buffer[]=[];let size=0;
 try{
  for await(const part of req){
   const b=Buffer.isBuffer(part)?part:Buffer.from(part);
   size+=b.length;if(size>256)throw new GuardShiftHttpErrorV516(413,"GUARD_SHIFT_INVALID_BODY");
   chunks.push(b);
  }
 }catch(e){
  if(e instanceof GuardShiftHttpErrorV516)throw e;
  throw new GuardShiftHttpErrorV516(400,"GUARD_SHIFT_INVALID_BODY");
 }
 if(!size||(raw!==undefined&&Number(raw)!==size))
  throw new GuardShiftHttpErrorV516(400,"GUARD_SHIFT_INVALID_BODY");
 let data:unknown;
 try{data=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
 catch{throw new GuardShiftHttpErrorV516(400,"GUARD_SHIFT_INVALID_BODY");}
 if(!data||Array.isArray(data)||typeof data!=="object")
  throw new GuardShiftHttpErrorV516(400,"GUARD_SHIFT_INVALID_BODY");
 return data as Record<string,unknown>;
}
export async function handleGuardShiftHttpV516(req:IncomingMessage,path:string,deps:GuardShiftHttpDependenciesV516):Promise<GuardShiftStatusV516>{
 if(path!==GUARD_SHIFT_PATH_V516)throw new GuardShiftHttpErrorV516(404,"GUARD_SHIFT_NOT_FOUND");
 if(req.method!=="GET"&&req.method!=="POST")
  throw new GuardShiftHttpErrorV516(405,"GUARD_SHIFT_METHOD_NOT_ALLOWED");
 const actor=bearer(req);
 if(req.method==="GET")return deps.get(actor);
 const data=await json(req);
 if(Object.keys(data).length!==2||typeof data.onShift!=="boolean"||typeof data.requestId!=="string")
  throw new GuardShiftHttpErrorV516(400,"GUARD_SHIFT_INVALID_BODY");
 let id:string;
 try{id=uuid(data.requestId);}catch{throw new GuardShiftHttpErrorV516(400,"GUARD_SHIFT_INVALID_BODY");}
 return deps.set(actor,id,data.onShift);
}
export function mapGuardShiftHttpErrorV516(error:unknown):GuardShiftHttpErrorV516{
 if(error instanceof GuardShiftHttpErrorV516)return error;
 switch((error as {code?:unknown}|null)?.code){
  case "JF003":return new GuardShiftHttpErrorV516(403,"GUARD_SHIFT_FORBIDDEN");
  case "JF001":return new GuardShiftHttpErrorV516(400,"GUARD_SHIFT_INVALID_BODY");
  case "JF005":return new GuardShiftHttpErrorV516(409,"GUARD_SHIFT_CONFLICT");
  default:return new GuardShiftHttpErrorV516(503,"GUARD_SHIFT_UNAVAILABLE");
 }
}
