import type { IncomingMessage, ServerResponse } from "node:http";
import { IdentityError, exactObject } from "./identity-primitives.ts";
import type { IdentityService } from "./identity.ts";

export type IdentityApi = Pick<IdentityService, "login" | "me" | "access" | "logout" | "requestEmail" | "consumeEmail" | "mfaStart" | "mfaConfirm" | "mfaChallenge" | "mfaRecoveryCodes" | "requestRegistration" | "completeRegistration" | "municipalities" | "joinPublicProfile" | "manageQuery" | "manageMutation">;
export const identityRoutes: Record<string, string> = {
  "/api/v1/auth/login": "POST", "/api/v1/auth/me": "GET",
  "/api/v1/auth/logout": "POST", "/api/v1/auth/logout-all": "POST", "/api/v1/access": "GET",
  "/api/v1/auth/email/request": "POST", "/api/v1/auth/email/confirm": "POST",
  "/api/v1/auth/password/request": "POST", "/api/v1/auth/password/reset": "POST",
  "/api/v1/auth/mfa/enroll/start": "POST", "/api/v1/auth/mfa/enroll/confirm": "POST",
  "/api/v1/auth/mfa/challenge": "POST", "/api/v1/auth/mfa/recovery-codes": "POST",
  "/api/v1/auth/registration/request": "POST", "/api/v1/auth/registration/complete": "POST",
  "/api/v1/auth/municipalities": "POST", "/api/v1/auth/public-profile": "POST",
  "/api/v1/management/query": "POST", "/api/v1/management/mutate": "POST",
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
  const ip = req.socket.remoteAddress ?? "unknown";
  if (url.pathname === "/api/v1/auth/login") return api.login(await readJson(req), ip, requestId);
  if (url.pathname === "/api/v1/auth/registration/request") return api.requestRegistration(await readJson(req),ip,requestId);
  if (url.pathname === "/api/v1/auth/registration/complete") return api.completeRegistration(await readJson(req),ip,requestId);
  if (url.pathname === "/api/v1/auth/municipalities") return api.municipalities(await readJson(req),ip);
  if (["/api/v1/auth/email/request", "/api/v1/auth/password/request"].includes(url.pathname))
    return api.requestEmail(await readJson(req), url.pathname.includes("/email/") ? "verify-email" : "reset-password", ip, requestId);
  if (["/api/v1/auth/email/confirm", "/api/v1/auth/password/reset"].includes(url.pathname))
    return api.consumeEmail(await readJson(req), url.pathname.includes("/email/") ? "verify-email" : "reset-password", ip, requestId);
  const token = bearer(req);
  if (url.pathname === "/api/v1/auth/public-profile") return api.joinPublicProfile(token,await readJson(req),ip,requestId);
  if (url.pathname === "/api/v1/management/query") return api.manageQuery(token,await readJson(req),ip,requestId);
  if (url.pathname === "/api/v1/management/mutate") return api.manageMutation(token,await readJson(req),ip,requestId);
  if (url.pathname === "/api/v1/auth/mfa/enroll/start") return api.mfaStart(token, await readJson(req), ip, requestId);
  if (url.pathname === "/api/v1/auth/mfa/enroll/confirm") return api.mfaConfirm(token, await readJson(req), ip, requestId);
  if (url.pathname === "/api/v1/auth/mfa/challenge") return api.mfaChallenge(token, await readJson(req), ip, requestId);
  if (url.pathname === "/api/v1/auth/mfa/recovery-codes") return api.mfaRecoveryCodes(token, await readJson(req), ip, requestId);
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
