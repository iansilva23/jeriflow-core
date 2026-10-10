import {IdentityError,exactObject,uuid} from "./identity-primitives.ts";
export type ParkingPlanningMode="all"|"present"|"needs_review"|"departed";
export function planningQuery(input:unknown){
 const body=exactObject(input,["municipalityId","after","mode"]);
 if(!Object.hasOwn(body,"municipalityId"))throw new IdentityError(400,"INVALID_INPUT");
 const mode=body.mode===undefined?"all":body.mode;
 if(!["all","present","needs_review","departed"].includes(String(mode)))
  throw new IdentityError(400,"INVALID_INPUT");
 return {municipalityId:uuid(body.municipalityId),after:body.after===undefined?null:uuid(body.after),
  mode:mode as ParkingPlanningMode};
}
export function planningExtend(input:unknown){
 const body=exactObject(input,["municipalityId","entryId","clientRequestId","revision","extraDays"]);
 if(Object.keys(body).length!==5||
  !Number.isSafeInteger(body.revision)||Number(body.revision)<1||
  !Number.isSafeInteger(body.extraDays)||Number(body.extraDays)<1||Number(body.extraDays)>30)
  throw new IdentityError(400,"INVALID_INPUT");
 return {municipalityId:uuid(body.municipalityId),entryId:uuid(body.entryId),
  clientRequestId:uuid(body.clientRequestId),revision:body.revision,extraDays:body.extraDays};
}
