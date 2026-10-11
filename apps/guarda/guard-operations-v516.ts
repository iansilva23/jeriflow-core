/** JeriFlow V5.16 — composição isolada da Guarda; não monta telas nem ativa APIs.
 * Fonte original SHA-256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 * Reutiliza guardRequest fechado na sessão de autenticação aprovada.
 */
import type {Transport} from "../../packages/auth/client.ts";
import {AuthFailure} from "../../packages/auth/client.ts";
import {guardReadClientV516} from "./guard-read-client-v516.ts";
import {guardServiceV516} from "./guard-service-v516.ts";
export function guardOperationsV516(transport:Transport,municipalityId:string){
 if(!transport.guardRequest)throw new AuthFailure("NOT_CONFIGURED");
 const secured=transport.guardRequest.bind(transport);
 const read=guardReadClientV516(path=>secured(municipalityId,path,"GET"));
 const service=guardServiceV516((path,method,body)=>secured(municipalityId,path,method,body));
 return {list:read.list,detail:read.detail,accept:service.accept,finish:service.finish};
}
