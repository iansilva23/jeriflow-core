/** Motor DETERMINÍSTICO DE LABORATÓRIO. NÃO verifica assinatura de PSP e nunca liquida pagamentos. */
export type SandboxEventKind="confirmed"|"refunded"|"chargeback";
export type SandboxEvent={
 id:string;municipalityId:string;orderId:string;
 providerReference:string;kind:SandboxEventKind;amountCents:number;currency:"BRL";
};
export type SandboxCase={
 municipalityId:string;orderId:string;expectedCents:number;currency:"BRL";
 events:readonly SandboxEvent[];
};
export type SandboxStatus="awaiting_sample"|"simulated_match"|"simulated_reversal"|"review_required";
export type SandboxResult={
 simulationOnly:true;financialEffectsEnabled:false;paymentRegistered:false;
 authorizationIssued:false;voucherIssued:false;debtCreated:false;paidUntil:null;
 status:SandboxStatus;reason:string;uniqueEvents:number;duplicateEvents:number;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ref=/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const permitted=new Set<string>(["confirmed","refunded","chargeback"]);
function cents(v:unknown):v is number{
 return typeof v==="number"&&Number.isSafeInteger(v)&&v>=1&&v<=90000000;
}
function hasKeys(v:unknown,keys:readonly string[]):v is Record<string,unknown>{
 return v!==null&&typeof v==="object"&&!Array.isArray(v)&&
   Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
}
const caseKeys=["municipalityId","orderId","expectedCents","currency","events"];
const eventKeys=["id","municipalityId","orderId","providerReference","kind","amountCents","currency"];
function badCase(v:unknown):v is SandboxCase{
 if(!hasKeys(v,caseKeys)||!uuid.test(String(v.municipalityId))||
    !uuid.test(String(v.orderId))||!cents(v.expectedCents)||v.currency!=="BRL"||
    !Array.isArray(v.events)||v.events.length>100)return false;
 return v.events.every(e=>hasKeys(e,eventKeys)&&
   uuid.test(String(e.id))&&uuid.test(String(e.municipalityId))&&
   uuid.test(String(e.orderId))&&typeof e.providerReference==="string"&&
   ref.test(e.providerReference)&&permitted.has(String(e.kind))&&
   cents(e.amountCents)&&e.currency==="BRL");
}
function makeResult(status:SandboxStatus,reason:string,uniqueEvents:number,duplicateEvents:number):SandboxResult{
 return Object.freeze({simulationOnly:true,financialEffectsEnabled:false,
  paymentRegistered:false,authorizationIssued:false,voucherIssued:false,
  debtCreated:false,paidUntil:null,status,reason,uniqueEvents,duplicateEvents});
}
export function reconcileParkingSandbox(input:unknown):SandboxResult{
 if(!badCase(input))throw Error("INVALID_SANDBOX_INPUT");
 const seen=new Map<string,string>(),events:SandboxEvent[]=[];
 let duplicates=0;
 for(const e of input.events){
  if(e.municipalityId.toLowerCase()!==input.municipalityId.toLowerCase()||
     e.orderId.toLowerCase()!==input.orderId.toLowerCase())
    return makeResult("review_required","FOREIGN_TENANT_OR_ORDER",events.length,duplicates);
  const signature=[e.id.toLowerCase(),e.municipalityId.toLowerCase(),e.orderId.toLowerCase(),
    e.providerReference,e.kind,e.amountCents,e.currency].join("|");
  const previous=seen.get(e.id.toLowerCase());
  if(previous!==undefined){
   if(previous!==signature)
    return makeResult("review_required","EVENT_REPLAY_CONFLICT",events.length,duplicates);
   duplicates++;continue;
  }
  seen.set(e.id.toLowerCase(),signature);events.push(e);
 }
 let state:"empty"|"matched"|"reversed"="empty";
 const referenceKeys=new Set<string>();
 for(const e of events){
  const key=e.providerReference;
  if(referenceKeys.has(key))
   return makeResult("review_required","REFERENCE_REUSED",events.length,duplicates);
  referenceKeys.add(key);
  if(e.amountCents!==input.expectedCents)
   return makeResult("review_required","AMOUNT_MISMATCH_OR_PARTIAL",events.length,duplicates);
  if(e.kind==="confirmed"){
   if(state!=="empty")
    return makeResult("review_required","DUPLICATE_OR_LATE_CONFIRMATION",events.length,duplicates);
   state="matched";
  }else{
   if(state!=="matched")
    return makeResult("review_required","REVERSAL_WITHOUT_MATCHED_CONFIRMATION",events.length,duplicates);
   state="reversed";
  }
 }
 if(state==="empty")return makeResult("awaiting_sample","NO_SAMPLE_EVENT",events.length,duplicates);
 if(state==="matched")return makeResult("simulated_match","SANDBOX_ONLY_NOT_SETTLED",events.length,duplicates);
 return makeResult("simulated_reversal","SANDBOX_REVERSAL_NO_MONEY_MOVED",events.length,duplicates);
}
