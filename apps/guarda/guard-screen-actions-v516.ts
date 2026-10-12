/** Adaptador da tela isolada Guarda V5.16 — sem montagem, rede ou credenciais próprias.
 * ZIP SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * Não inventa protocolo; consome tabela canônica via operações da PR #58.
 */
import type {Transport} from "../../packages/auth/client.ts";
import {guardOperationsV516} from "./guard-operations-v516.ts";
import type {GuardQueueFilterV516} from "./guard-read-client-v516.ts";
import type {GuardQueueItemV516,GuardScreenActionsV516} from "./GuardQueueScreenV516.tsx";
import type {GuardFinishFormV516} from "./GuardFinishPanelV516.tsx";
const PROTOCOL=/^JF-[0-9]{8}-[0-9]{6}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function listItems(value:Record<string,unknown>):ReadonlyArray<GuardQueueItemV516>{
 if(!Array.isArray(value.items))throw new Error("INVALID_GUARD_RESPONSE");
 return value.items.map((item:unknown)=>{
  if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("INVALID_GUARD_RESPONSE");
  const record=item as Record<string,unknown>;
  if(typeof record.protocolId!=="string"||!PROTOCOL.test(record.protocolId)
    ||!["RECEBIDA","EM ATENDIMENTO","FINALIZADA"].includes(String(record.status))
    ||!(record.title==null||typeof record.title==="string")
    ||!(record.location==null||typeof record.location==="string"))
    throw new Error("INVALID_GUARD_RESPONSE");
  return {protocolId:record.protocolId,status:record.status as string,
   title:typeof record.title==="string"?record.title:undefined,
   location:typeof record.location==="string"?record.location:undefined};
 });
}
export function guardScreenActionsV516(
 transport:Transport,municipalityId:string,newRequestId:()=>string
):GuardScreenActionsV516{
 const operations=guardOperationsV516(transport,municipalityId);
 // Escopo: somente esta sessão/município. A mesma tentativa conserva seu UUID
 // após erro de rede, para aproveitar a idempotência já existente no PostgreSQL.
 const attempts=new Map<string,{id:string;payload:string;completed:boolean}>();
 function mutationId(key:string,payload:string):string{
  const previous=attempts.get(key);
  if(previous){
   if(previous.completed)throw new Error("GUARD_OPERATION_ALREADY_CONFIRMED");
   if(previous.payload!==payload)throw new Error("GUARD_RETRY_PAYLOAD_CHANGED");
   return previous.id;
  }
  const id=newRequestId();
  if(!UUID.test(id))throw new Error("INVALID_GUARD_REQUEST_ID");
  attempts.set(key,{id,payload,completed:false});
  return id;
 }
 async function run(key:string,payload:string,perform:(id:string)=>Promise<unknown>):Promise<void>{
  const id=mutationId(key,payload);
  try{
   await perform(id);
   // Não conservar anotações da ocorrência após confirmação.
   attempts.set(key,{id:"",payload:"",completed:true});
  }catch(error){
   // Falha de validação local não pode contaminar a próxima tentativa válida.
   if(error instanceof Error&&error.message==="INVALID_GUARD_MUTATION")attempts.delete(key);
   throw error;
  }
 }
 return {
  load:async(filter:GuardQueueFilterV516)=>listItems(await operations.list(filter)),
  open:protocolId=>operations.detail(protocolId),
  accept:async protocolId=>{
   await run("accept:"+protocolId,"",id=>operations.accept(protocolId,id));
  },
  finish:async(protocolId:string,data:GuardFinishFormV516)=>{
   const payload=JSON.stringify([data.result,data.action,data.note.trim()]);
   await run("finish:"+protocolId,payload,id=>
    operations.finish(protocolId,{requestId:id,...data}));
  }
 };
}
