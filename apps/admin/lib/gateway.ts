import { authMethods, canonicalToken, identityContext, type IdentityContext } from "../../../packages/contracts/src/identity.ts";
export const sessionCookie = "jeriflow_admin_session";
export type GatewayConfig = { origin: string; api: string };
export function gatewayConfig(): GatewayConfig {
  const origin = new URL(process.env.JERIFLOW_ADMIN_ORIGIN ?? "http://127.0.0.1:3000");
  const api = new URL(process.env.JERIFLOW_API_URL ?? "http://127.0.0.1:3001");
  for (const url of [origin, api]) if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))) throw new Error("INVALID_SERVER_CONFIGURATION");
  return { origin: origin.origin, api: api.origin };
}
export function cookieToken(header: string | null): string | undefined {
  const values = (header ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(sessionCookie + "="));
  if (values.length !== 1) return undefined;
  const value = values[0].slice(sessionCookie.length + 1); return canonicalToken(value) ? value : undefined;
}
function cookie(value: string, seconds: number, config: GatewayConfig) {
  return `${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${config.origin.startsWith("https:") ? "; Secure" : ""}`;
}
function response(status: number, body: object, setCookie?: string) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", ...(setCookie ? { "Set-Cookie": setCookie } : {}) } });
}
async function bodyText(request: Request, maxBytes = 8192): Promise<string> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new Error("BODY_TOO_LARGE");
  const reader = request.body?.getReader(); if (!reader) return "{}";
  let length = 0, timedOut = false; const chunks: Uint8Array[] = [];
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length; if (length > maxBytes) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); } chunks.push(value);
    }
    if (timedOut) throw new Error("BODY_TIMEOUT");
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); JSON.parse(text); return text;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
export async function upstream(config: GatewayConfig, path: string, token?: string, body?: string, method = "GET") {
  const result = await fetch(config.api + "/api/v1" + path, { method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body });
  const data: Record<string, unknown> = await result.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("INVALID_UPSTREAM");
  return { status: result.status, data, retry: result.headers.get("retry-after") };
}
// BFF: browser não recebe Bearer; caminhos, origem e método são allowlists.
export async function gateway(request: Request, path: string, config = gatewayConfig()): Promise<Response> {
  const url = new URL(request.url), expected = new URL(config.origin);
  // NextURL normaliza 127.0.0.1 para localhost. Só aceitar essa transformação
  // com protocolo/porta iguais e Host original exatamente configurado.
  const normalizedLoopback = expected.hostname === "127.0.0.1" && url.hostname === "localhost" && url.protocol === expected.protocol && url.port === expected.port;
  if ((!normalizedLoopback && url.origin !== config.origin) || request.headers.get("host") !== expected.host)
    return response(403, { error: "ORIGIN_NOT_ALLOWED" });
  if (!Object.hasOwn(authMethods, path) || url.search) return response(404, { error: "NOT_FOUND" });
  if (request.method !== authMethods[path]) return response(405, { error: "METHOD_NOT_ALLOWED" });
  if (request.method === "POST" && (request.headers.get("origin") !== config.origin || request.headers.get("x-jeriflow-request") !== "1"
    || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin"))) return response(403, { error: "ORIGIN_NOT_ALLOWED" });
  if (request.method === "POST" && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? ""))
    return response(415, { error: "JSON_REQUIRED" });
  const token = cookieToken(request.headers.get("cookie"));
  const publicPath = ["/auth/login", "/auth/email/request", "/auth/email/confirm", "/auth/password/request", "/auth/password/reset", "/auth/registration/request", "/auth/registration/complete", "/auth/municipalities"].includes(path);
  if (!token && !publicPath) return response(401, { error: "UNAUTHORIZED" }, cookie("", 0, config));
  let body: string | undefined;
  try { body = request.method === "POST" ? await bodyText(request, path === "/ouvidoria/attachments/upload" ? 1460000 : 8192) : undefined; }
  catch (error) { return response(error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400, { error: "INVALID_INPUT" }); }
  try {
    const result = await upstream(config, path, token, body, request.method);
    let setCookie: string | undefined;
    if (result.status === 200 && Object.hasOwn(result.data, "accessToken")) {
      const fresh = result.data.accessToken;
      const expiry = typeof result.data.expiresAt === "string" ? Date.parse(result.data.expiresAt) : NaN;
      if (!canonicalToken(fresh) || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("INVALID_SESSION");
      setCookie = cookie(fresh, Math.min(28800, Math.max(1, Math.floor((expiry-Date.now())/1000))), config);
    }
    delete result.data.accessToken;
    if (["UNAUTHORIZED", "REAUTHENTICATION_REQUIRED"].includes(String(result.data.error)) ||
      (result.status === 200 && ["/auth/logout", "/auth/logout-all", "/auth/email/confirm", "/auth/password/reset", "/auth/registration/complete"].includes(path))) setCookie = cookie("",0,config);
    const res = response(result.status, result.data, setCookie);
    if (result.retry && /^\d+$/.test(result.retry)) res.headers.set("Retry-After", result.retry);
    return res;
  } catch {
    // Sair deste navegador é possível offline, mas não declarar revogação remota.
    if (path === "/auth/logout") return response(200, { signedOut: true, remoteRevoked: false }, cookie("",0,config));
    return response(503, { error: "IDENTITY_UNAVAILABLE" });
  }
}
export async function serverContext(cookieHeader: string | null, config = gatewayConfig()): Promise<IdentityContext | undefined> {
  const token = cookieToken(cookieHeader); if (!token) return undefined;
  const result = await upstream(config, "/auth/me", token);
  if (result.status === 401) return undefined;
  if (result.status !== 200) throw new Error("IDENTITY_UNAVAILABLE");
  return identityContext(result.data);
}
