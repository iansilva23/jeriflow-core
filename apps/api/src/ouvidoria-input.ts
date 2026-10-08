import { IdentityError, exactObject, uuid } from "./identity-primitives.ts";

export type OuvidoriaScope = "meus" | "fila";
export type OuvidoriaOperation = "create" | "triage" | "respond" | "contest" | "close";

function invalid(): never { throw new IdentityError(400, "INVALID_INPUT"); }
function fields(value: unknown, expected: readonly string[]) {
  const body = exactObject(value, expected);
  if (Object.keys(body).length !== expected.length || expected.some(key => body[key] === undefined)) invalid();
  return body;
}
function safeText(value: unknown, min: number, max: number) {
  if (typeof value !== "string") invalid();
  const text = value.trim();
  const size = [...text].length;
  if (size < min || size > max || /[\u0000-\u001f\u007f]/u.test(text) || Buffer.byteLength(text, "utf8") > max * 4) invalid();
  return text;
}
function revision(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 2147483647) invalid();
  return value as number;
}

export function ouvidoriaQuery(input: unknown) {
  const body = exactObject(input, ["municipalityId", "scope", "after"]);
  const scope = body.scope;
  if (scope !== "meus" && scope !== "fila") invalid();
  return { municipalityId: uuid(body.municipalityId), scope: scope as OuvidoriaScope,
    after: body.after === undefined ? null : uuid(body.after) };
}

export function ouvidoriaMutation(input: unknown) {
  const body = exactObject(input, ["operation", "municipalityId", "clientRequestId", "category", "title", "description", "protocolId", "revision", "message"]);
  if (typeof body.operation !== "string" || !["create", "triage", "respond", "contest", "close"].includes(body.operation)) invalid();
  const operation = body.operation as OuvidoriaOperation;
  const municipalityId = uuid(body.municipalityId);
  if (operation === "create") {
    const b = fields(body, ["operation", "municipalityId", "clientRequestId", "category", "title", "description"]);
    if (!["denuncia", "reclamacao", "solicitacao", "sugestao"].includes(String(b.category))) invalid();
    return { operation, municipalityId, clientRequestId: uuid(b.clientRequestId),
      category: b.category as string, title: safeText(b.title, 5, 120), description: safeText(b.description, 20, 4000) };
  }
  const expected = operation === "respond" || operation === "contest"
    ? ["operation", "municipalityId", "protocolId", "revision", "message"]
    : ["operation", "municipalityId", "protocolId", "revision"];
  const b = fields(body, expected);
  return { operation, municipalityId, protocolId: uuid(b.protocolId), revision: revision(b.revision),
    ...(operation === "respond" || operation === "contest" ? { message: safeText(b.message, 15, 2000) } : {}) };
}
