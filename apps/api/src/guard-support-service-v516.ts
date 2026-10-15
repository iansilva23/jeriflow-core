/** JeriFlow V5.16 — adaptador privado do pedido de apoio da Guarda.
 * Origem: guarda-semus/index.html supportModal/supportSend e migração 026.
 * ZIP original SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 * NÃO envia alerta/despacho, não modifica status e não está conectado ao HTTP/UI.
 */
import pg from "pg";
import {sessionHash,uuid} from "./identity-primitives.ts";

export const GUARD_SUPPORT_REASONS_V516=[
 "Necessidade de outro agente","Via bloqueada","Conflito no local","Outro"
] as const;
export type GuardSupportReasonV516=typeof GUARD_SUPPORT_REASONS_V516[number];
export type GuardSupportActorV516=Readonly<{municipalityId:string;sessionToken:string}>;
export type GuardSupportRecordV516=Readonly<{
 requestId:string;protocolId:string;recorded:true;alreadyProcessed:boolean;
}>;
export type GuardSupportAdminItemV516=Readonly<{
 requestId:string;protocolId:string;reason:string;note:string;createdAt:string;guardName:string;
}>;

const PROTOCOL=/^JF-[0-9]{8}-[0-9]{6}$/;
function record(value:unknown):GuardSupportRecordV516{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("GUARD_SUPPORT_INVALID_RESPONSE");
 const x=value as Record<string,unknown>;
 if(typeof x.requestId!=="string"||typeof x.protocolId!=="string"||
   x.recorded!==true||typeof x.alreadyProcessed!=="boolean"||
   !PROTOCOL.test(x.protocolId))throw new Error("GUARD_SUPPORT_INVALID_RESPONSE");
 return {requestId:uuid(x.requestId),protocolId:x.protocolId,recorded:true,
  alreadyProcessed:x.alreadyProcessed};
}
function queue(value:unknown):ReadonlyArray<GuardSupportAdminItemV516>{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("GUARD_SUPPORT_INVALID_RESPONSE");
 const items=(value as {items?:unknown}).items;
 if(!Array.isArray(items)||items.length>50)throw new Error("GUARD_SUPPORT_INVALID_RESPONSE");
 return items.map((x:unknown)=>{
  if(!x||typeof x!=="object"||Array.isArray(x))throw new Error("GUARD_SUPPORT_INVALID_RESPONSE");
  const row=x as Record<string,unknown>;
  if(typeof row.requestId!=="string"||typeof row.protocolId!=="string"||
    !PROTOCOL.test(row.protocolId)||
    typeof row.reason!=="string"||!GUARD_SUPPORT_REASONS_V516.some(v=>v===row.reason)||
    typeof row.note!=="string"||typeof row.createdAt!=="string"||
    typeof row.guardName!=="string")throw new Error("GUARD_SUPPORT_INVALID_RESPONSE");
  return {requestId:uuid(row.requestId),protocolId:row.protocolId,
   reason:row.reason,note:row.note,createdAt:row.createdAt,guardName:row.guardName};
 });
}
export class GuardSupportServiceV516{
 private readonly pool:pg.Pool;
 constructor(databaseUrl:string){
  if(!databaseUrl)throw new Error("GUARD_SUPPORT_DATABASE_REQUIRED");
  this.pool=new pg.Pool({connectionString:databaseUrl,max:3,connectionTimeoutMillis:2500,
   statement_timeout:4500,query_timeout:5000,application_name:"jeriflow-v516-guard-support-private"});
  this.pool.on("error",()=>{});
 }
 async close():Promise<void>{await this.pool.end();}
 /** Retorna apenas a confirmação de REGISTRO, nunca entrega ou despacho. */
 async submit(actor:GuardSupportActorV516,protocolId:string,requestId:string,
  reason:GuardSupportReasonV516,note:string):Promise<GuardSupportRecordV516>{
  if(!PROTOCOL.test(protocolId)||!GUARD_SUPPORT_REASONS_V516.some(v=>v===reason)||
     typeof note!=="string"||note.trim().length>2000)throw new Error("GUARD_SUPPORT_INVALID_INPUT");
  const id=uuid(requestId),municipalityId=uuid(actor.municipalityId);
  const result=await this.pool.query<{data:unknown}>(
   "SELECT app.guard_v516_support_submit($1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::text) AS data",
   [municipalityId,sessionHash(actor.sessionToken),protocolId,id,reason,note.trim()]);
  const confirmed=record(result.rows[0]?.data);
  if(confirmed.requestId!==id||confirmed.protocolId!==protocolId)
   throw new Error("GUARD_SUPPORT_INVALID_RESPONSE");
  return confirmed;
 }
 /** Administração SEMUS: listagem de pedidos registrados, sem envio de alerta. */
 async adminQueue(actor:GuardSupportActorV516,after:string|null=null,limit=50){
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error("GUARD_SUPPORT_INVALID_INPUT");
  const result=await this.pool.query<{data:unknown}>(
   "SELECT app.guard_v516_support_admin_queue($1::uuid,$2::text,$3::uuid,$4::integer) AS data",
   [uuid(actor.municipalityId),sessionHash(actor.sessionToken),after===null?null:uuid(after),limit]);
  return queue(result.rows[0]?.data);
 }
}
