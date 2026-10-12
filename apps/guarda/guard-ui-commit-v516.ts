/** V5.16 Guarda: uma mutação pode concluir mesmo se a consulta seguinte falhar.
 * Nunca interpretar falha de recarga como falha da operação já confirmada.
 * Não armazena sessões, tokens ou dados pessoais.
 */
export async function commitGuardAndRefreshV516<T>(
 commit:()=>Promise<void>,refresh:()=>Promise<ReadonlyArray<T>>
):Promise<{committed:true;items:ReadonlyArray<T>|null}>{
 await commit();
 try{return {committed:true,items:await refresh()};}
 catch{return {committed:true,items:null};}
}
