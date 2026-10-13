/** Cliente móvel isolado do plantão V5.16 da Guarda.
 * Fonte original: guarda-semus/index.html, shiftBtn/onShift.
 * ZIP SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 * Sem ativação no App; o backend continua autoridade para município/papel/sessão.
 */
import {apiBase,AuthFailure} from "../../packages/auth/client.ts";
import {canonicalToken} from "../../packages/contracts/src/identity.ts";
import type {GuardCredentialsV516} from "./guard-authenticated-transport-v516.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH="/api/v1/guarda/plantao";
export type GuardMobileShiftV516=Readonly<{onShift:boolean;updatedAt:string|null;alreadyProcessed?:boolean}>;

function validate(value:unknown):GuardMobileShiftV516{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new AuthFailure("INVALID_RESPONSE");
 const x=value as Record<string,unknown>;
 if(typeof x.onShift!=="boolean"||!(x.updatedAt===null||typeof x.updatedAt==="string")||
   !(x.alreadyProcessed===undefined||typeof x.alreadyProcessed==="boolean"))
  throw new AuthFailure("INVALID_RESPONSE");
 return {onShift:x.onShift,updatedAt:x.updatedAt as string|null,
  ...(typeof x.alreadyProcessed==="boolean"?{alreadyProcessed:x.alreadyProcessed}:{})};
}
export function guardShiftMobileClientV516(config:GuardCredentialsV516){
 const origin=apiBase(config.endpoint);
 if(!UUID.test(config.municipalityId))throw new AuthFailure("INVALID_INPUT");
 const http=config.request??fetch;
 async function call(method:"GET"|"POST",body?:{requestId:string;onShift:boolean}):Promise<GuardMobileShiftV516>{
  if(method==="POST"&&(!body||!UUID.test(body.requestId)||typeof body.onShift!=="boolean"))
   throw new AuthFailure("INVALID_INPUT");
  const token=await config.readToken();
  if(!canonicalToken(token))throw new AuthFailure("UNAUTHORIZED",401);
  let response:Response;
  try{
   response=await http(origin+PATH,{method,
    headers:{"Accept":"application/json","Authorization":"Bearer "+token,
     "X-JeriFlow-Municipality-Id":config.municipalityId,
     ...(method==="POST"?{"Content-Type":"application/json"}:{})},
    ...(method==="POST"?{body:JSON.stringify(body)}:{}),
    redirect:"error",cache:"no-store"
   });
  }catch{throw new AuthFailure("NETWORK");}
  let data:unknown;
  try{data=await response.json();}catch{throw new AuthFailure("INVALID_RESPONSE");}
  if(!response.ok){
   const code=typeof (data as {error?:unknown}|null)?.error==="string"?
    (data as {error:string}).error:"UNAVAILABLE";
   throw new AuthFailure(code,response.status);
  }
  return validate(data);
 }
 return {
  get:()=>call("GET"),
  set:(requestId:string,onShift:boolean)=>call("POST",{requestId,onShift})
 };
}
