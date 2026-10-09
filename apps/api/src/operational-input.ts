import {IdentityError,exactObject,uuid} from "./identity-primitives.ts";
const bad=():never=>{throw new IdentityError(400,"INVALID_INPUT")};
export function municipalInput(input:unknown){
 const obj=exactObject(input,["municipalityId"]);
 if(Object.keys(obj).length!==1)return bad();
 return {municipalityId:uuid(obj.municipalityId)};
}
export function notificationReadInput(input:unknown){
 const obj=exactObject(input,["municipalityId","notificationId"]);
 if(Object.keys(obj).length!==2)return bad();
 return {municipalityId:uuid(obj.municipalityId),notificationId:uuid(obj.notificationId)};
}
function safeText(x:unknown,min:number,max:number){
 if(typeof x!=="string")return bad();
 const s=x.trim();
 if([...s].length<min||[...s].length>max||/[\u0000-\u001f\u007f]/u.test(s))return bad();
 return s;
}
export function guardaMutationInput(input:unknown){
 const obj=exactObject(input,["municipalityId","operation","clientRequestId","category","locationText","description","occurrenceId","revision"]);
 const municipalityId=uuid(obj.municipalityId);
 if(obj.operation==="create"){
  if(Object.keys(obj).length!==6||!["apoio","transito","patrulhamento","outros"].includes(String(obj.category)))
   return bad();
  return {municipalityId,operation:"create",clientRequestId:uuid(obj.clientRequestId),
   category:obj.category,locationText:safeText(obj.locationText,5,120),
   description:safeText(obj.description,20,2000)};
 }
 if(obj.operation==="start"||obj.operation==="resolve"){
  if(Object.keys(obj).length!==4||!Number.isSafeInteger(obj.revision)||
   (obj.revision as number)<1||(obj.revision as number)>2147483647)return bad();
  return {municipalityId,operation:obj.operation,occurrenceId:uuid(obj.occurrenceId),
   revision:obj.revision};
 }
 return bad();
}
