/** Contrato isolado de atendimento da Guarda V5.16, ainda NÃO conectado ao RN.
 * Referência: ZIP original SHA-256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * Não obtém credenciais, não faz fetch e não modifica o AuthController.
 */
export const GUARD_RESULTS_V516 = [
  "Veículo encontrado", "Veículo não encontrado",
  "Situação já resolvida", "Denúncia não confirmada"
] as const;
export const GUARD_ACTIONS_V516 = [
  "Orientação realizada", "Autuação realizada",
  "Veículo removido/direcionado", "Solicitado apoio",
  "Sem providência necessária"
] as const;
export type GuardResultV516 = typeof GUARD_RESULTS_V516[number];
export type GuardActionV516 = typeof GUARD_ACTIONS_V516[number];
export type GuardFinishInputV516 = Readonly<{
  requestId: string; result: GuardResultV516;
  action: GuardActionV516; note: string;
}>;
export type GuardRequestV516 = (
  path: string, method: "POST", body: Record<string,string>
) => Promise<Record<string,unknown>>;
const PROTOCOL = /^JF-[0-9]{8}-[0-9]{6}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function requireId(protocol: string, requestId: string): void {
  if (!PROTOCOL.test(protocol) || !UUID.test(requestId)) throw new Error("INVALID_GUARD_MUTATION");
}
function status(result: Record<string, unknown>, expected: string, protocol: string): Record<string, unknown> {
  if (result.protocolId !== protocol || result.status !== expected)
    throw new Error("INVALID_GUARD_RESPONSE");
  return result;
}
export function guardServiceV516(request: GuardRequestV516) {
  return {
    async accept(protocol: string, requestId: string): Promise<Record<string,unknown>> {
      requireId(protocol, requestId);
      return status(await request("/api/v1/guarda/transito/" + protocol + "/atender", "POST", {requestId}), "EM ATENDIMENTO",protocol);
    },
    async finish(protocol: string, input: GuardFinishInputV516): Promise<Record<string,unknown>> {
      requireId(protocol, input.requestId);
      if (!GUARD_RESULTS_V516.includes(input.result) || !GUARD_ACTIONS_V516.includes(input.action)
        || typeof input.note !== "string" || input.note.length > 2000
        || /[\u0000-\u001f\u007f]/.test(input.note.replace(/\n/g,"")))
        throw new Error("INVALID_GUARD_MUTATION");
      return status(await request("/api/v1/guarda/transito/" + protocol + "/finalizar", "POST", {
        requestId: input.requestId, result: input.result, action: input.action, note: input.note.trim()
      }), "FINALIZADA",protocol);
    }
  };
}
