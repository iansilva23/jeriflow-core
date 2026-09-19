import type { IncomingMessage, ServerResponse } from "node:http";
import { IdentityError, exactObject } from "./identity-primitives.ts";
import type { IdentityService } from "./identity.ts";

export type IdentityApi = Pick<IdentityService, "login" | "me" | "access" | "logout">;
export const identityRoutes: Record<string, string> = {
  "/api/v1/auth/login": "POST", "/api/v1/auth/me": "GET",
  "/api/v1/auth/logout": "POST", "/api/v1/auth/logout-all": "POST", "/api/v1/access": "GET",
};
function bearer(req: IncomingMessage): string {
  const headers = req.headersDistinct.authorization;
  if (headers?.length !== 1 || !/^Bearer [A-Za-z0-9_-]{43}$/.test(headers[0])) throw new IdentityError(401, "UNAUTHORIZED");
  return headers[0].slice(7);
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")
    || (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity")) throw new IdentityError(415, "JSON_REQUIRED");
  if (Number(req.headers["content-length"] ?? 0) > 8192) throw new IdentityError(413, "BODY_TOO_LARGE");
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let bytes = 0;
    const finish = (error?: Error) => {
      clearTimeout(timer); req.off("data", data); req.off("end", end); req.off("aborted", aborted); req.off("error", aborted);
      if (error) { req.resume(); reject(error); }
    };
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8192) { finish(new IdentityError(413, "BODY_TOO_LARGE")); return; }
      parts.push(chunk);
    };
    const end = () => {
      finish();
      try { resolve(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)))); }
      catch { reject(new IdentityError(400, "INVALID_JSON")); }
    };
    const aborted = () => finish(new IdentityError(400, "REQUEST_ABORTED"));
    const timer = setTimeout(() => finish(new IdentityError(408, "REQUEST_TIMEOUT")), 5000);
    req.on("data", data); req.once("end", end); req.once("aborted", aborted); req.once("error", aborted);
  });
}
export async function identityRequest(req: IncomingMessage, res: ServerResponse, api: IdentityApi | undefined, requestId: string) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const requiredMethod = identityRoutes[url.pathname];
  if (req.method !== requiredMethod) {
    res.setHeader("Allow", requiredMethod); throw new IdentityError(405, "METHOD_NOT_ALLOWED");
  }
  // Clientes móveis usam Bearer. O administrativo será conectado por servidor
  // com cookie HttpOnly; nenhum token precisa ser salvo em localStorage.
  if (req.headers.origin) throw new IdentityError(403, "ORIGIN_NOT_ALLOWED");
  if (!api) throw new IdentityError(503, "IDENTITY_UNAVAILABLE");
  if (url.pathname !== "/api/v1/access" && url.search) throw new IdentityError(400, "INVALID_INPUT");
  if (req.method === "GET" && (req.headers["transfer-encoding"] || Number(req.headers["content-length"] ?? 0))) throw new IdentityError(400, "INVALID_INPUT");
  if (url.pathname === "/api/v1/auth/login") return api.login(await readJson(req), req.socket.remoteAddress ?? "unknown", requestId);
  const token = bearer(req);
  if (url.pathname === "/api/v1/auth/me") return api.me(token);
  if (url.pathname === "/api/v1/access") {
    if ([...url.searchParams.keys()].some(k => !["permission", "municipalityId"].includes(k) || url.searchParams.getAll(k).length !== 1))
      throw new IdentityError(400, "INVALID_INPUT");
    return api.access(token, url.searchParams.get("municipalityId") ?? undefined, url.searchParams.get("permission") ?? "", requestId);
  }
  exactObject(await readJson(req), []);
  await api.logout(token, url.pathname === "/api/v1/auth/logout-all", requestId);
  return { signedOut: true };
}
