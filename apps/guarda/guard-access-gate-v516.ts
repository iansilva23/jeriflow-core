/** V5.16 Guarda — portão isolado de permissão antes de montar a área operacional.
 * Fonte suprema: ZIP SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 * Não substitui validação SQL de role 'guarda'/'admin-semus' em cada chamada.
 */
import {AuthFailure,type Transport} from "../../packages/auth/client.ts";
import type {IdentityContext} from "../../packages/contracts/src/identity.ts";
import {guardScreenActionsV516} from "./guard-screen-actions-v516.ts";

const PERMISSION="mobile:guarda:access";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function guardEligibleMunicipalitiesV516(context:IdentityContext):ReadonlyArray<{id:string;displayName:string}> {
 if(context.security.nextStep!=="ready"||!context.security.emailVerified)
  return [];
 return context.municipalities.filter(m=>UUID.test(m.id)&&m.permissions.includes(PERMISSION))
   .map(m=>({id:m.id,displayName:m.displayName}));
}
/** Faz checagem REST /access existente; cria ações somente após 200.
 * Não retorna token; a autorização real de cada operação continua no banco.
 */
export async function guardAuthorizedActionsV516(
 transport:Transport,context:IdentityContext,municipalityId:string,newRequestId:()=>string
) {
 if(!guardEligibleMunicipalitiesV516(context).some(m=>m.id===municipalityId))
  throw new AuthFailure("FORBIDDEN",403);
 const access=await transport.request("/access?"+new URLSearchParams({municipalityId,permission:PERMISSION}).toString());
 // O servidor V5.16 devolve {allowed:true,municipalityId,permission}.
 // Um HTTP 200 sem a concessão exata nunca deve abrir a área operacional.
 if(access.allowed!==true||access.municipalityId!==municipalityId||access.permission!==PERMISSION)
  throw new AuthFailure("FORBIDDEN",403);
 return guardScreenActionsV516(transport,municipalityId,newRequestId);
}
