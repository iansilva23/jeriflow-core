/** Guarda V5.16: ações de apoio em sessão autorizada, fora da UI.
 * Fonte suprema: ZIP SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 * Registro administrativo apenas; não envia alerta nem despacho.
 */
import type {Transport} from "../../packages/auth/client.ts";

export const GUARD_SUPPORT_REASONS_V516=[
 "Necessidade de outro agente","Via bloqueada","Conflito no local","Outro"
] as const;
export type GuardSupportReasonV516=typeof GUARD_SUPPORT_REASONS_V516[number];
export type GuardSupportActionsV516=Readonly<{
 submit:(protocolId:string,reason:GuardSupportReasonV516,note:string)=>Promise<void>;
}>;
const ID=/^JF-[0-9]{8}-[0-9]{6}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Pending=Readonly<{requestId:string;payload:string}>;

export function guardSupportActionsV516(transport:Transport,municipalityId:string,
 newRequestId:()=>string):GuardSupportActionsV516{
 if(!transport.supportRequest)throw new Error("GUARD_SUPPORT_NOT_CONFIGURED");
 const send=transport.supportRequest.bind(transport);
 const attempts=new Map<string,Pending>();
 return {submit:async(protocolId,reason,note)=>{
  if(!ID.test(protocolId)||!GUARD_SUPPORT_REASONS_V516.some(v=>v===reason)||
   typeof note!=="string"||note.trim().length>2000||
   /[\u0000-\u0009\u000b-\u001f\u007f]/.test(note))
   throw new Error("GUARD_SUPPORT_INVALID_INPUT");
  const payload=JSON.stringify([reason,note.trim()]);
  const old=attempts.get(protocolId);
  if(old&&old.payload!==payload)throw new Error("GUARD_SUPPORT_RETRY_PAYLOAD_CHANGED");
  const requestId=old?.requestId??newRequestId();
  if(!UUID.test(requestId))throw new Error("GUARD_SUPPORT_INVALID_REQUEST_ID");
  if(!old)attempts.set(protocolId,{requestId,payload});
  const result=await send(municipalityId,protocolId,{requestId,reason,note:note.trim()});
  if(result.recorded!==true||result.requestId!==requestId||
   result.protocolId!==protocolId||typeof result.alreadyProcessed!=="boolean")
   throw new Error("GUARD_SUPPORT_INVALID_RESPONSE");
  attempts.delete(protocolId);
 }};
}
