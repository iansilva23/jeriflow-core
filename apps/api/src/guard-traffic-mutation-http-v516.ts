/**
 * JeriFlow V5.16 — HTTP interno do botão ATENDER e FINALIZAR, desligado.
 * ZIP original SHA256:
 * 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * guarda-semus/index.html acceptReport(), finishBtn/serviceResult/serviceAction.
 * SEM alterar a função PG original 024 nem ativar no main.ts.
 */
import type {IncomingMessage} from "node:http";
import pg from "pg";
import {sessionHash,uuid} from "./identity-primitives.ts";

const PATH=/^\/api\/v1\/guarda\/transito\/(JF-[0-9]{8}-[0-9]{6,})\/(atender|finalizar)$/;
const RESULT=new Set([
 "Veículo encontrado","Veículo não encontrado","Situação já resolvida",
 "Denúncia não confirmada"
]);
const ACTION=new Set([
 "Orientação realizada","Autuação realizada","Veículo removido/direcionado",
 "Solicitado apoio","Sem providência necessária"
]);
export type GuardHttpActorV516=Readonly<{
 municipalityId:string;sessionToken:string;
}>;
export type GuardHttpFinishV516=Readonly<{
 requestId:string;result:string;action:string;note:string;
}>;
export type GuardMutationDependenciesV516=Readonly<{
 accept(actor:GuardHttpActorV516,protocolId:string,requestId:string):Promise<unknown>;
 finish(actor:GuardHttpActorV516,protocolId:string,data:GuardHttpFinishV516):Promise<unknown>;
}>;
export class GuardMutationHttpErrorV516 extends Error{
 readonly status:number;
 readonly code:"GUARD_MUTATION_SESSION_REQUIRED"|"GUARD_MUTATION_DENIED"|
  "INVALID_GUARD_MUTATION"|"GUARD_MUTATION_CONFLICT"|
  "GUARD_MUTATION_NOT_FOUND"|"GUARD_MUTATION_UNAVAILABLE";
 constructor(status:number,code:GuardMutationHttpErrorV516["code"]){
  super(code);this.status=status;this.code=code;
 }
}
export function isGuardMutationHttpPathV516(path:string):boolean{
 return /\/(?:atender|finalizar)$/.test(path)
   && path.startsWith("/api/v1/guarda/transito/");
}
function header(req:IncomingMessage,key:string):string|null{
 const v=req.headers[key];return typeof v==="string"?v:null;
}
function actor(req:IncomingMessage):GuardHttpActorV516{
 const raw=header(req,"authorization");
 const mid=header(req,"x-jeriflow-municipality-id");
 const token=raw?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
 if(!token||!mid)throw new GuardMutationHttpErrorV516(401,"GUARD_MUTATION_SESSION_REQUIRED");
 try{sessionHash(token);return{municipalityId:uuid(mid),sessionToken:token};}
 catch{throw new GuardMutationHttpErrorV516(401,"GUARD_MUTATION_SESSION_REQUIRED");}
}
async function body(req:IncomingMessage):Promise<Record<string,unknown>>{
 const contentType=header(req,"content-type")?.toLowerCase();
 if(contentType!=="application/json"&&contentType!=="application/json; charset=utf-8")
  throw new GuardMutationHttpErrorV516(415,"INVALID_GUARD_MUTATION");
 if(req.headers["content-encoding"]!==undefined||
    req.headers["transfer-encoding"]!==undefined)
  throw new GuardMutationHttpErrorV516(415,"INVALID_GUARD_MUTATION");
 const rawLength=header(req,"content-length");
 if(req.headers["content-length"]!==undefined &&
    (!rawLength||!/^[0-9]+$/.test(rawLength)))
  throw new GuardMutationHttpErrorV516(400,"INVALID_GUARD_MUTATION");
 const size=rawLength===null?null:Number(rawLength);
 if(size!==null&&(!Number.isSafeInteger(size)||size<2||size>4096))
  throw new GuardMutationHttpErrorV516(413,"INVALID_GUARD_MUTATION");
 const chunks:Buffer[]=[];
 let total=0;
 try{
  for await(const chunk of req){
   const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
   total+=bytes.byteLength;
   if(total>4096)throw new GuardMutationHttpErrorV516(413,"INVALID_GUARD_MUTATION");
   chunks.push(bytes);
  }
 }catch(e){
  if(e instanceof GuardMutationHttpErrorV516)throw e;
  throw new GuardMutationHttpErrorV516(400,"INVALID_GUARD_MUTATION");
 }
 if(total<2||(size!==null&&total!==size))
  throw new GuardMutationHttpErrorV516(400,"INVALID_GUARD_MUTATION");
 let data:unknown;
 try{data=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
 catch{throw new GuardMutationHttpErrorV516(400,"INVALID_GUARD_MUTATION");}
 if(data===null||typeof data!=="object"||Array.isArray(data))
  throw new GuardMutationHttpErrorV516(400,"INVALID_GUARD_MUTATION");
 return data as Record<string,unknown>;
}
function exact(data:Record<string,unknown>,fields:string[]){
 if(Object.keys(data).length!==fields.length||
   Object.keys(data).some(k=>!fields.includes(k)))
   throw new GuardMutationHttpErrorV516(400,"INVALID_GUARD_MUTATION");
}
function requestId(value:unknown):string{
 try{return uuid(value);}catch{throw new GuardMutationHttpErrorV516(400,"INVALID_GUARD_MUTATION");}
}
export async function handleGuardMutationHttpV516(
 req:IncomingMessage,path:string,service:GuardMutationDependenciesV516
):Promise<Record<string,unknown>>{
 if(req.method!=="POST")
  throw new GuardMutationHttpErrorV516(405,"INVALID_GUARD_MUTATION");
 const match=PATH.exec(path);
 if(!match)throw new GuardMutationHttpErrorV516(400,"INVALID_GUARD_MUTATION");
 const user=actor(req);
 const data=await body(req);
 let result:unknown;
 if(match[2]==="atender"){
  exact(data,["requestId"]);
  result=await service.accept(user,match[1],requestId(data.requestId));
 }else{
  exact(data,["requestId","result","action","note"]);
  if(typeof data.result!=="string"||!RESULT.has(data.result)||
     typeof data.action!=="string"||!ACTION.has(data.action)||
     typeof data.note!=="string"||data.note.length>2000||
     /[\u0000-\u001f\u007f]/.test(data.note.replace(/\n/g,"")))
   throw new GuardMutationHttpErrorV516(400,"INVALID_GUARD_MUTATION");
  result=await service.finish(user,match[1],{
   requestId:requestId(data.requestId),
   result:data.result,action:data.action,note:data.note.trim()
  });
 }
 if(!result||typeof result!=="object"||Array.isArray(result))
  throw new GuardMutationHttpErrorV516(503,"GUARD_MUTATION_UNAVAILABLE");
 return result as Record<string,unknown>;
}
export function mapGuardMutationHttpErrorV516(error:unknown):GuardMutationHttpErrorV516{
 if(error instanceof GuardMutationHttpErrorV516)return error;
 const code=(error as {code?:unknown}|null)?.code;
 if(code==="JF003")return new GuardMutationHttpErrorV516(403,"GUARD_MUTATION_DENIED");
 if(code==="JF004")return new GuardMutationHttpErrorV516(404,"GUARD_MUTATION_NOT_FOUND");
 if(code==="JF001")return new GuardMutationHttpErrorV516(400,"INVALID_GUARD_MUTATION");
 if(code==="JF005"||code==="23505")
  return new GuardMutationHttpErrorV516(409,"GUARD_MUTATION_CONFLICT");
 return new GuardMutationHttpErrorV516(503,"GUARD_MUTATION_UNAVAILABLE");
}
export class GuardMutationServiceV516 implements GuardMutationDependenciesV516{
 private pool:pg.Pool;
 constructor(databaseUrl:string){
  if(typeof databaseUrl!=="string"||!databaseUrl)
   throw new GuardMutationHttpErrorV516(503,"GUARD_MUTATION_UNAVAILABLE");
  this.pool=new pg.Pool({
   connectionString:databaseUrl,max:3,connectionTimeoutMillis:2500,
   statement_timeout:4500,query_timeout:5000,
   application_name:"jeriflow-v516-guard-mutation-private"
  });
  this.pool.on("error",()=>{});
 }
 async close(){await this.pool.end();}
 async accept(user:GuardHttpActorV516,protocol:string,id:string):Promise<unknown>{
  const r=await this.pool.query<{data:unknown}>(
   "SELECT app.guard_v516_accept($1::uuid,$2::text,$3::text,$4::uuid) AS data",
   [uuid(user.municipalityId),sessionHash(user.sessionToken),protocol,uuid(id)]);
  return r.rows[0]?.data;
 }
 async finish(user:GuardHttpActorV516,protocol:string,data:GuardHttpFinishV516):Promise<unknown>{
  const r=await this.pool.query<{data:unknown}>(
   "SELECT app.guard_v516_finish("+
   "$1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::text,$7::text) AS data",
   [uuid(user.municipalityId),sessionHash(user.sessionToken),protocol,
    uuid(data.requestId),data.result,data.action,data.note]);
  return r.rows[0]?.data;
 }
}
