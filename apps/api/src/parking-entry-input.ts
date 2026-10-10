import {IdentityError,exactObject,uuid} from "./identity-primitives.ts";
function validText(value:unknown,min:number,max:number):string{
 if(typeof value!=="string"||value.trim().length<min||value.trim().length>max||
   /[\u0000-\u001f\u007f]/.test(value))throw new IdentityError(400,"INVALID_INPUT");
 return value.trim();
}
export function entryDraftQuery(input:unknown){
 const raw=exactObject(input,["municipalityId","after"]);
 if(!Object.hasOwn(raw,"municipalityId"))throw new IdentityError(400,"INVALID_INPUT");
 return {municipalityId:uuid(raw.municipalityId),after:raw.after===undefined?null:uuid(raw.after)};
}
export function entryDraftHistory(input:unknown){
 const raw=exactObject(input,["municipalityId","entryId"]);
 if(Object.keys(raw).length!==2)throw new IdentityError(400,"INVALID_INPUT");
 return {municipalityId:uuid(raw.municipalityId),entryId:uuid(raw.entryId)};
}
export function entryDraftMutation(input:unknown){
 const raw=exactObject(input,["municipalityId","operation","clientRequestId",
  "vehiclePlate","vehicleBrand","vehicleModel","areaText","lodgingName","entryId","revision"]);
 const municipalityId=uuid(raw.municipalityId);
 if(raw.operation==="enter"){
  if(![7,8].includes(Object.keys(raw).length)||typeof raw.vehiclePlate!=="string"||
   !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(raw.vehiclePlate)||
   Object.hasOwn(raw,"entryId")||Object.hasOwn(raw,"revision"))
   throw new IdentityError(400,"INVALID_INPUT");
  return {municipalityId,operation:"enter" as const,
   clientRequestId:uuid(raw.clientRequestId),vehiclePlate:raw.vehiclePlate,
   vehicleBrand:validText(raw.vehicleBrand,2,60),
   vehicleModel:validText(raw.vehicleModel,2,60),
   areaText:validText(raw.areaText,5,120),
   lodgingName:raw.lodgingName===undefined?null:validText(raw.lodgingName,3,120)};
 }
 if(raw.operation==="depart"){
  if(Object.keys(raw).length!==4||!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1)
   throw new IdentityError(400,"INVALID_INPUT");
  return {municipalityId,operation:"depart" as const,entryId:uuid(raw.entryId),revision:raw.revision};
 }
 throw new IdentityError(400,"INVALID_INPUT");
}
