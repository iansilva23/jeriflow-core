/** Adaptador da tela isolada Guarda V5.16 — sem montagem, rede ou credenciais próprias.
 * ZIP SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * Não inventa protocolo; consome tabela canônica via operações da PR #58.
 */
import type {Transport} from "../../packages/auth/client.ts";
import {guardOperationsV516} from "./guard-operations-v516.ts";
import type {GuardQueueFilterV516} from "./guard-read-client-v516.ts";
import type {GuardQueueItemV516,GuardScreenActionsV516} from "./GuardQueueScreenV516.tsx";
const PROTOCOL=/^JF-[0-9]{8}-[0-9]{6}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function listItems(value:Record<string,unknown>):ReadonlyArray<GuardQueueItemV516>{
 if(!Array.isArray(value.items))throw new Error("INVALID_GUARD_RESPONSE");
 return value.items.map((item:unknown)=>{
  if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("INVALID_GUARD_RESPONSE");
  const record=item as Record<string,unknown>;
  if(typeof record.protocolId!=="string"||!PROTOCOL.test(record.protocolId)
    ||!["RECEBIDA","EM ATENDIMENTO","FINALIZADA"].includes(String(record.status))
    ||typeof record.title!=="string"||typeof record.location!=="string")
    throw new Error("INVALID_GUARD_RESPONSE");
  return {protocolId:record.protocolId,status:record.status as string,
   title:record.title,location:record.location};
 });
}
export function guardScreenActionsV516(
 transport:Transport,municipalityId:string,newRequestId:()=>string
):GuardScreenActionsV516{
 const operations=guardOperationsV516(transport,municipalityId);
 return {
  load:async(filter:GuardQueueFilterV516)=>listItems(await operations.list(filter)),
  open:protocolId=>operations.detail(protocolId),
  accept:async protocolId=>{
   const id=newRequestId();
   if(!UUID.test(id))throw new Error("INVALID_GUARD_REQUEST_ID");
   await operations.accept(protocolId,id);
  }
 };
}
