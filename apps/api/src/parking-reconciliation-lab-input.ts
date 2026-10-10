import {IdentityError,exactObject,uuid} from "./identity-primitives.ts";
const kinds=["sample_confirmation","sample_refund","sample_chargeback"];
const sampleRef=/^TEST_[A-Z0-9_]{3,60}$/;
function valueCents(value:unknown):number{
 if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1||value>90000000)
   throw new IdentityError(400,"INVALID_INPUT");
 return value;
}
export function labMutation(input:unknown){
 const body=exactObject(input,["operation","municipalityId","clientRequestId",
  "orderKey","expectedCents","caseId","sampleEventId","sampleReference",
  "sampleKind","sampleAmountCents"]);
 const municipalityId=uuid(body.municipalityId);
 if(body.operation==="create_case"){
  if(Object.keys(body).length!==5)throw new IdentityError(400,"INVALID_INPUT");
  return {operation:"create_case" as const,municipalityId,
   clientRequestId:uuid(body.clientRequestId),orderKey:uuid(body.orderKey),
   expectedCents:valueCents(body.expectedCents)};
 }
 if(body.operation==="append_event"){
  if(Object.keys(body).length!==7||
     typeof body.sampleReference!=="string"||!sampleRef.test(body.sampleReference)||
     !kinds.includes(String(body.sampleKind)))
   throw new IdentityError(400,"INVALID_INPUT");
  return {operation:"append_event" as const,municipalityId,
   caseId:uuid(body.caseId),sampleEventId:uuid(body.sampleEventId),
   sampleReference:body.sampleReference,
   sampleKind:body.sampleKind as "sample_confirmation"|"sample_refund"|"sample_chargeback",
   sampleAmountCents:valueCents(body.sampleAmountCents)};
 }
 throw new IdentityError(400,"INVALID_INPUT");
}
export function labQuery(input:unknown){
 const body=exactObject(input,["municipalityId","caseId"]);
 if(Object.keys(body).length!==2)throw new IdentityError(400,"INVALID_INPUT");
 return {municipalityId:uuid(body.municipalityId),caseId:uuid(body.caseId)};
}
