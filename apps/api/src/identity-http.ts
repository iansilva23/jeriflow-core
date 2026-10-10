import type { IncomingMessage, ServerResponse } from "node:http";
import { IdentityError, exactObject } from "./identity-primitives.ts";
import type { IdentityService } from "./identity.ts";

export type IdentityApi = Pick<IdentityService, "login" | "me" | "access" | "logout" | "requestEmail" | "consumeEmail" | "mfaStart" | "mfaConfirm" | "mfaChallenge" | "mfaRecoveryCodes" | "requestRegistration" | "completeRegistration" | "municipalities" | "joinPublicProfile" | "manageQuery" | "manageMutation" | "ouvidoriaQuery" | "ouvidoriaMutation" | "ouvidoriaHistory" | "ouvidoriaAttachmentUpload" | "ouvidoriaAttachmentList" | "ouvidoriaAttachmentReadTest" | "ouvidoriaNoticesQuery" | "ouvidoriaNoticeRead" | "ouvidoriaRetentionReview" | "ouvidoriaRetentionInventory" | "ouvidoriaRetentionDraft" | "ouvidoriaRetentionArchive" | "guardaQuery" | "guardaMutation" | "guardaHistory" | "parkingServiceQuery" | "parkingServiceMutation" | "parkingServiceHistory" | "parkingEntryQuery" | "parkingEntryMutation" | "parkingEntryHistory" | "parkingEntryExtend" | "parkingTariffQuery" | "parkingTariffMutation" | "parkingTariffHistory" | "parkingLabMutation" | "parkingLabQuery">;
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
  "/api/v1/ouvidoria/query": "POST", "/api/v1/ouvidoria/mutate": "POST",
  "/api/v1/ouvidoria/history": "POST",
  "/api/v1/ouvidoria/attachments/upload": "POST", "/api/v1/ouvidoria/attachments/list": "POST",
  "/api/v1/ouvidoria/attachments/read-test": "POST",
  "/api/v1/ouvidoria/notices/query": "POST", "/api/v1/ouvidoria/notices/read": "POST",
  "/api/v1/ouvidoria/retention/review": "POST",
  "/api/v1/ouvidoria/retention/inventory": "POST",
  "/api/v1/ouvidoria/retention/draft": "POST",
  "/api/v1/ouvidoria/retention/archive": "POST",
  "/api/v1/guarda/query": "POST", "/api/v1/guarda/mutate": "POST", "/api/v1/guarda/history": "POST",
  "/api/v1/parking/requests/query": "POST", "/api/v1/parking/requests/mutate": "POST",
  "/api/v1/parking/requests/history": "POST",
  "/api/v1/parking/entries/query": "POST", "/api/v1/parking/entries/mutate": "POST",
  "/api/v1/parking/entries/history": "POST", "/api/v1/parking/entries/extend": "POST",
  "/api/v1/parking/tariff/query": "POST", "/api/v1/parking/tariff/mutate": "POST",
  "/api/v1/parking/tariff/history": "POST",
  "/api/v1/parking/lab/mutate": "POST", "/api/v1/parking/lab/query": "POST",
};
function bearer(req: IncomingMessage): string {
  const headers = req.headersDistinct.authorization;
  if (headers?.length !== 1 || !/^Bearer [A-Za-z0-9_-]{43}$/.test(headers[0])) throw new IdentityError(401, "UNAUTHORIZED");
  return headers[0].slice(7);
}
async function readJson(req: IncomingMessage, maxBytes = 8192): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")
    || (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity")) throw new IdentityError(415, "JSON_REQUIRED");
  if (Number(req.headers["content-length"] ?? 0) > maxBytes) throw new IdentityError(413, "BODY_TOO_LARGE");
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let bytes = 0;
    const finish = (error?: Error) => {
      clearTimeout(timer); req.off("data", data); req.off("end", end); req.off("aborted", aborted); req.off("error", aborted);
      if (error) { req.resume(); reject(error); }
    };
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { finish(new IdentityError(413, "BODY_TOO_LARGE")); return; }
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
  if (url.pathname === "/api/v1/ouvidoria/query") return api.ouvidoriaQuery(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/ouvidoria/mutate") return api.ouvidoriaMutation(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/ouvidoria/history") return api.ouvidoriaHistory(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/ouvidoria/attachments/upload") return api.ouvidoriaAttachmentUpload(token,await readJson(req,1460000),requestId);
  if (url.pathname === "/api/v1/ouvidoria/attachments/list") return api.ouvidoriaAttachmentList(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/ouvidoria/attachments/read-test") return api.ouvidoriaAttachmentReadTest(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/ouvidoria/notices/query") return api.ouvidoriaNoticesQuery(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/ouvidoria/notices/read") return api.ouvidoriaNoticeRead(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/ouvidoria/retention/review") return api.ouvidoriaRetentionReview(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/ouvidoria/retention/inventory") return api.ouvidoriaRetentionInventory(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/ouvidoria/retention/draft") return api.ouvidoriaRetentionDraft(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/ouvidoria/retention/archive") return api.ouvidoriaRetentionArchive(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/guarda/query") return api.guardaQuery(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/guarda/mutate") return api.guardaMutation(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/guarda/history") return api.guardaHistory(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/requests/query") return api.parkingServiceQuery(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/requests/mutate") return api.parkingServiceMutation(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/requests/history") return api.parkingServiceHistory(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/entries/query") return api.parkingEntryQuery(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/entries/mutate") return api.parkingEntryMutation(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/entries/history") return api.parkingEntryHistory(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/entries/extend") return api.parkingEntryExtend(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/tariff/query") return api.parkingTariffQuery(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/tariff/mutate") return api.parkingTariffMutation(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/tariff/history") return api.parkingTariffHistory(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/lab/mutate") return api.parkingLabMutation(token,await readJson(req),requestId);
  if (url.pathname === "/api/v1/parking/lab/query") return api.parkingLabQuery(token,await readJson(req),requestId);
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
