import { IdentityError, exactObject, uuid } from "./identity-primitives.ts";

function stringValue(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max ||
    /[\u0000-\u001f\u007f]/.test(value)) throw new IdentityError(400, "INVALID_INPUT");
  return value.trim();
}
function serviceDay(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value+"T00:00:00.000Z")) ||
    new Date(value+"T00:00:00.000Z").toISOString().slice(0,10)!==value)
    throw new IdentityError(400, "INVALID_INPUT");
  return value;
}
export function parkingQuery(input: unknown) {
  const body=exactObject(input,["municipalityId","scope","after"]);
  if(Object.keys(body).length<2||!["mine","queue"].includes(String(body.scope)))
    throw new IdentityError(400,"INVALID_INPUT");
  return {municipalityId:uuid(body.municipalityId),scope:body.scope as "mine"|"queue",
    after:body.after===undefined?null:uuid(body.after)};
}
export function parkingHistory(input:unknown) {
  const body=exactObject(input,["municipalityId","requestId"]);
  if(Object.keys(body).length!==2)throw new IdentityError(400,"INVALID_INPUT");
  return {municipalityId:uuid(body.municipalityId),requestId:uuid(body.requestId)};
}
export function parkingMutation(input:unknown) {
  const raw=exactObject(input,["municipalityId","operation","clientRequestId",
    "vehiclePlate","areaText","serviceDay","description","requestId","revision","message"]);
  const municipalityId=uuid(raw.municipalityId),operation=raw.operation;
  if(!["create","triage","answer","reject"].includes(String(operation)))
    throw new IdentityError(400,"INVALID_INPUT");
  if(operation==="create"){
    if(Object.keys(raw).length!==7||typeof raw.vehiclePlate!=="string"||
      !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(raw.vehiclePlate))
      throw new IdentityError(400,"INVALID_INPUT");
    return {municipalityId,operation,clientRequestId:uuid(raw.clientRequestId),
      vehiclePlate:raw.vehiclePlate,
      areaText:stringValue(raw.areaText,5,120),
      serviceDay:serviceDay(raw.serviceDay),
      description:stringValue(raw.description,10,1000)};
  }
  if(operation==="triage"){
    if(Object.keys(raw).length!==4||!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1)
      throw new IdentityError(400,"INVALID_INPUT");
    return {municipalityId,operation,requestId:uuid(raw.requestId),revision:raw.revision};
  }
  if(Object.keys(raw).length!==5||!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1)
    throw new IdentityError(400,"INVALID_INPUT");
  return {municipalityId,operation,requestId:uuid(raw.requestId),revision:raw.revision,
    message:stringValue(raw.message,15,1000)};
}
