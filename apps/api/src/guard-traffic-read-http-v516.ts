/**
 * V5.16 — transporte HTTP SOMENTE LEITURA da fila/detalhe Trânsito da Guarda.
 *
 * Fonte suprema (reaberta antes do commit):
 * JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip
 * SHA-256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * guarda-semus/index.html renderQueues()/openDetail();
 * admin-semus/index.html fila, mesma tabela citizen_v516_traffic_protocols.
 *
 * Não é ativado em apps/api/src/main.ts. NÃO aceita mutações, uploads, URL de
 * fotos, protocolo novo, sessão por deviceId nem chaves de outras roles.
 */
import type {IncomingMessage} from "node:http";
import pg from "pg";
import {sessionHash,uuid} from "./identity-primitives.ts";

const PROTOCOL=/^JF-[0-9]{8}-[0-9]{6,}$/;
const FILTERS=new Set(["ALL","NEW","IN_SERVICE","FINISHED"]);
const ROOT="/api/v1/guarda/transito";
export type GuardReadContextV516=Readonly<{
 municipalityId:string;sessionToken:string;
}>;
export type GuardTrafficReadHttpDependenciesV516=Readonly<{
 list(context:GuardReadContextV516,filter:string,after:string|null,limit:number):Promise<unknown>;
 detail(context:GuardReadContextV516,protocolId:string):Promise<unknown>;
}>;
export class GuardReadHttpErrorV516 extends Error {
 readonly status:number;
 readonly code:"GUARD_SESSION_REQUIRED"|"GUARD_ACCESS_DENIED"|
  "INVALID_GUARD_QUERY"|"GUARD_PROTOCOL_NOT_FOUND"|"GUARD_READ_UNAVAILABLE";
 constructor(status:number,code:GuardReadHttpErrorV516["code"]){
  super(code);this.status=status;this.code=code;
 }
}
export function isGuardReadHttpPathV516(path:string):boolean {
 return path===ROOT||path.startsWith(ROOT+"/");
}
function header(req:IncomingMessage,key:string):string|null{
 const value=req.headers[key];
 return typeof value==="string"?value:null;
}
function authorization(req:IncomingMessage):GuardReadContextV516{
 const auth=header(req,"authorization");
 const municipality=header(req,"x-jeriflow-municipality-id");
 const token=auth?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
 if(!token||!municipality)
  throw new GuardReadHttpErrorV516(401,"GUARD_SESSION_REQUIRED");
 try{
  sessionHash(token);uuid(municipality);
 }catch{
  throw new GuardReadHttpErrorV516(401,"GUARD_SESSION_REQUIRED");
 }
 return {sessionToken:token,municipalityId:municipality.toLowerCase()};
}
function validateQuery(req:IncomingMessage,path:string):Readonly<{
 filter:string;after:string|null;limit:number;
}>{
 const url=new URL(req.url??"/","http://localhost");
 if(url.search.length>250)
  throw new GuardReadHttpErrorV516(400,"INVALID_GUARD_QUERY");
 if(path!==ROOT){
  if(url.search)
   throw new GuardReadHttpErrorV516(400,"INVALID_GUARD_QUERY");
  return {filter:"ALL",after:null,limit:20};
 }
 const query=url.searchParams;
 if([...query.keys()].some(k=>!["filter","after","limit"].includes(k))
    ||["filter","after","limit"].some(k=>query.getAll(k).length>1))
   throw new GuardReadHttpErrorV516(400,"INVALID_GUARD_QUERY");
 const filter=query.get("filter")??"ALL";
 const after=query.get("after");
 const rawLimit=query.get("limit")??"20";
 if(!FILTERS.has(filter)||(after!==null&&!PROTOCOL.test(after))||
    !/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit))
  throw new GuardReadHttpErrorV516(400,"INVALID_GUARD_QUERY");
 return {filter,after,limit:Number(rawLimit)};
}
export async function handleGuardReadHttpV516(
 req:IncomingMessage,path:string,
 service:GuardTrafficReadHttpDependenciesV516
):Promise<unknown>{
 if(req.method!=="GET")
  throw new GuardReadHttpErrorV516(405,"INVALID_GUARD_QUERY");
 if(req.headers["content-length"]!==undefined||
    req.headers["transfer-encoding"]!==undefined||
    req.headers["content-encoding"]!==undefined)
  throw new GuardReadHttpErrorV516(400,"INVALID_GUARD_QUERY");
 // Não usar cookie, parâmetros da URL, identificador do dispositivo,
 // nem cabeçalhos x-role, x-guard-id ou x-citizen-id como autorização.
 const context=authorization(req);
 const {filter,after,limit}=validateQuery(req,path);
 if(path===ROOT) return service.list(context,filter,after,limit);
 const protocol=path.slice(ROOT.length+1);
 if(!PROTOCOL.test(protocol))
  throw new GuardReadHttpErrorV516(400,"INVALID_GUARD_QUERY");
 return service.detail(context,protocol);
}
export function mapGuardReadErrorV516(error:unknown):GuardReadHttpErrorV516{
 if(error instanceof GuardReadHttpErrorV516)return error;
 const code=(error as {code?:unknown}|null)?.code;
 if(code==="JF003")return new GuardReadHttpErrorV516(403,"GUARD_ACCESS_DENIED");
 if(code==="JF004")return new GuardReadHttpErrorV516(404,"GUARD_PROTOCOL_NOT_FOUND");
 if(code==="JF001")return new GuardReadHttpErrorV516(400,"INVALID_GUARD_QUERY");
 return new GuardReadHttpErrorV516(503,"GUARD_READ_UNAVAILABLE");
}
/** Usa EXCLUSIVAMENTE funções SECURITY DEFINER 023; nenhum SQL direto. */
export class GuardTrafficReadServiceV516 implements GuardTrafficReadHttpDependenciesV516{
 private readonly pool:pg.Pool;
 constructor(databaseUrl:string){
  if(typeof databaseUrl!=="string"||!databaseUrl)
   throw new GuardReadHttpErrorV516(503,"GUARD_READ_UNAVAILABLE");
  this.pool=new pg.Pool({
   connectionString:databaseUrl,max:4,connectionTimeoutMillis:2500,
   statement_timeout:4000,query_timeout:4500,
   application_name:"jeriflow-v516-guard-read-private"
  });
  this.pool.on("error",()=>{});
 }
 async close():Promise<void>{await this.pool.end();}
 async list(ctx:GuardReadContextV516,filter:string,after:string|null,limit:number):Promise<unknown>{
  const response=await this.pool.query<{response:unknown}>(
   "SELECT app.citizen_v516_guard_queue("+
   "$1::uuid,$2::text,$3::text,$4::text,$5::integer) AS response",
   [uuid(ctx.municipalityId),sessionHash(ctx.sessionToken),filter,after,limit]);
  if(response.rowCount!==1)throw new GuardReadHttpErrorV516(503,"GUARD_READ_UNAVAILABLE");
  return response.rows[0].response;
 }
 async detail(ctx:GuardReadContextV516,protocolId:string):Promise<unknown>{
  if(!PROTOCOL.test(protocolId))
   throw new GuardReadHttpErrorV516(400,"INVALID_GUARD_QUERY");
  const response=await this.pool.query<{response:unknown}>(
   "SELECT app.citizen_v516_guard_detail("+
   "$1::uuid,$2::text,$3::text) AS response",
   [uuid(ctx.municipalityId),sessionHash(ctx.sessionToken),protocolId]);
  if(response.rowCount!==1)throw new GuardReadHttpErrorV516(503,"GUARD_READ_UNAVAILABLE");
  return response.rows[0].response;
 }
}
