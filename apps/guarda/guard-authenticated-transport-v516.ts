/** JeriFlow V5.16: transporte privado Guarda, não conectado à UI.
 * ZIP original SHA-256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 * O backend é a autoridade final para MFA, município e papel Guarda.
 */
import {apiBase,AuthFailure} from "../../packages/auth/client.ts";
import {canonicalToken} from "../../packages/contracts/src/identity.ts";
export type GuardCredentialsV516=Readonly<{
  readToken:()=>Promise<string|null>;
  municipalityId:string;
  endpoint:string;
  request?:typeof fetch;
}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH=/^\/api\/v1\/guarda\/transito(?:\/(?:JF-[0-9]{8}-[0-9]{6})(?:\/(?:atender|finalizar))?)?$/;
export function guardAuthenticatedTransportV516(config:GuardCredentialsV516){
 const origin=apiBase(config.endpoint);
 if(!UUID.test(config.municipalityId))throw new AuthFailure("INVALID_INPUT");
 const http=config.request??fetch;
 return async(path:string,method:"GET"|"POST"="GET",body?:Record<string,string>):Promise<Record<string,unknown>>=>{
  if(!PATH.test(path.split("?")[0])||!(method==="GET"||method==="POST")||
    (method==="GET"&&body!==undefined)||(method==="POST"&&body===undefined)||
    (method==="POST"&&!/\/(atender|finalizar)$/.test(path))||
    (method==="GET"&&/\/(atender|finalizar)$/.test(path)))
    throw new AuthFailure("INVALID_INPUT");
  const url=new URL(origin+path);
  if(url.origin!==origin||!url.pathname.startsWith("/api/v1/guarda/transito")||
    [...url.searchParams.keys()].some(k=>!["filter","limit","after"].includes(k))||
    (url.search&&url.pathname!=="/api/v1/guarda/transito")||
    ["filter","limit","after"].some(k=>url.searchParams.getAll(k).length>1))
    throw new AuthFailure("INVALID_INPUT");
  const token=await config.readToken();
  if(!canonicalToken(token))throw new AuthFailure("UNAUTHORIZED",401);
  let response:Response;
  try{response=await http(url.toString(),{
   method,
   headers:{"Accept":"application/json","Authorization":"Bearer "+token,
    "X-JeriFlow-Municipality-Id":config.municipalityId,
    ...(method==="POST"?{"Content-Type":"application/json"}:{})},
   ...(method==="POST"?{body:JSON.stringify(body)}:{}),
   redirect:"error",cache:"no-store"
  });}catch{throw new AuthFailure("NETWORK");}
  let result:unknown;
  try{result=await response.json();}catch{throw new AuthFailure("INVALID_RESPONSE");}
  if(!result||typeof result!=="object"||Array.isArray(result))throw new AuthFailure("INVALID_RESPONSE");
  const data=result as Record<string,unknown>;
  if(!response.ok)throw new AuthFailure(typeof data.error==="string"?data.error:"UNAVAILABLE",response.status);
  return data;
 };
}
