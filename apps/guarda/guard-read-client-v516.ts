/** Cliente de leitura isolado: injetar transporte autenticado somente após homologação.
 * Referência V5.16 SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * Não lê token, não inicia rede e não conecta telas.
 */
export type GuardReadRequestV516 = (path: string) => Promise<Record<string,unknown>>;
export type GuardQueueFilterV516 = "ALL" | "NEW" | "IN_SERVICE" | "FINISHED";
const FILTERS = new Set(["ALL","NEW","IN_SERVICE","FINISHED"]);
const PROTOCOL = /^JF-[0-9]{8}-[0-9]{6}$/;
const ROOT="/api/v1/guarda/transito";
export function guardReadClientV516(request: GuardReadRequestV516) {
  return {
    async list(filter: GuardQueueFilterV516="ALL", after: string|null=null, limit=20) {
      if(!FILTERS.has(filter)|| (after!==null&&!PROTOCOL.test(after))||
        !Number.isInteger(limit)||limit<1||limit>50)throw new Error("INVALID_GUARD_QUERY");
      const params=new URLSearchParams({filter,limit:String(limit)});
      if(after!==null)params.set("after",after);
      const response=await request(ROOT+"?"+params.toString());
      if(!Array.isArray(response.items))throw new Error("INVALID_GUARD_RESPONSE");
      return response;
    },
    async detail(protocolId: string) {
      if(!PROTOCOL.test(protocolId))throw new Error("INVALID_GUARD_QUERY");
      const response=await request(ROOT+"/"+protocolId);
      if(response.protocolId!==protocolId)throw new Error("INVALID_GUARD_RESPONSE");
      return response;
    }
  };
}
