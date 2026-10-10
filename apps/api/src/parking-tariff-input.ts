import {IdentityError,exactObject,uuid} from "./identity-primitives.ts";
export function tariffDraftQuery(input:unknown){
 const body=exactObject(input,["municipalityId","entryId"]);
 if(!Object.hasOwn(body,"municipalityId"))throw new IdentityError(400,"INVALID_INPUT");
 return {municipalityId:uuid(body.municipalityId),
  entryId:body.entryId===undefined?null:uuid(body.entryId)};
}
export function tariffDraftHistory(input:unknown){
 const body=exactObject(input,["municipalityId"]);
 if(Object.keys(body).length!==1)throw new IdentityError(400,"INVALID_INPUT");
 return {municipalityId:uuid(body.municipalityId)};
}
export function tariffDraftMutation(input:unknown){
 const body=exactObject(input,["municipalityId","clientRequestId","revision","dailyRateCents","rationale"]);
 if(Object.keys(body).length!==5||
   !Number.isSafeInteger(body.revision)||Number(body.revision)<0||
   !Number.isSafeInteger(body.dailyRateCents)||
   Number(body.dailyRateCents)<1||Number(body.dailyRateCents)>1000000||
   typeof body.rationale!=="string"||
   body.rationale.trim().length<15||body.rationale.trim().length>500||
   /[\u0000-\u001f\u007f]/.test(body.rationale))
   throw new IdentityError(400,"INVALID_INPUT");
 return {municipalityId:uuid(body.municipalityId),
  clientRequestId:uuid(body.clientRequestId),
  revision:body.revision,dailyRateCents:body.dailyRateCents,
  rationale:body.rationale.trim()};
}
