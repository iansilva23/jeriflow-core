/** Guarda V5.16 — adaptador SQL isolado para o botão EM/FORA DE SERVIÇO.
 * Fonte original: guarda-semus/index.html shiftBtn/onShift.
 * Ainda não roteado em server.ts nem montado no App; main.ts permanece inalterado.
 * onShift informa disponibilidade, NÃO bloqueia atendimento ou finalização.
 */
import pg from "pg";
import {sessionHash,uuid} from "./identity-primitives.ts";

export type GuardShiftActorV516=Readonly<{municipalityId:string;sessionToken:string}>;
export type GuardShiftStatusV516=Readonly<{onShift:boolean;updatedAt:string|null;alreadyProcessed?:boolean}>;

function status(value:unknown):GuardShiftStatusV516{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("GUARD_SHIFT_INVALID_RESPONSE");
 const data=value as Record<string,unknown>;
 if(typeof data.onShift!=="boolean"||
    !(data.updatedAt===null||typeof data.updatedAt==="string")||
    !(data.alreadyProcessed===undefined||typeof data.alreadyProcessed==="boolean"))
   throw new Error("GUARD_SHIFT_INVALID_RESPONSE");
 return {onShift:data.onShift,updatedAt:data.updatedAt as string|null,
   ...(typeof data.alreadyProcessed==="boolean"?{alreadyProcessed:data.alreadyProcessed}:{})};
}
export class GuardShiftServiceV516{
 private pool:pg.Pool;
 constructor(databaseUrl:string){
  if(!databaseUrl)throw new Error("GUARD_SHIFT_DATABASE_REQUIRED");
  this.pool=new pg.Pool({connectionString:databaseUrl,max:3,connectionTimeoutMillis:2500,
   statement_timeout:4500,query_timeout:5000,application_name:"jeriflow-v516-guard-shift-private"});
  this.pool.on("error",()=>{});
 }
 async close():Promise<void>{await this.pool.end();}
 async get(actor:GuardShiftActorV516):Promise<GuardShiftStatusV516>{
  const result=await this.pool.query<{data:unknown}>(
   "SELECT app.guard_v516_shift_get($1::uuid,$2::text) AS data",
   [uuid(actor.municipalityId),sessionHash(actor.sessionToken)]);
  return status(result.rows[0]?.data);
 }
 async set(actor:GuardShiftActorV516,id:string,onShift:boolean):Promise<GuardShiftStatusV516>{
  if(typeof onShift!=="boolean")throw new Error("GUARD_SHIFT_INVALID_INPUT");
  const result=await this.pool.query<{data:unknown}>(
   "SELECT app.guard_v516_shift_set($1::uuid,$2::text,$3::uuid,$4::boolean) AS data",
   [uuid(actor.municipalityId),sessionHash(actor.sessionToken),uuid(id),onShift]);
  return status(result.rows[0]?.data);
 }
}
