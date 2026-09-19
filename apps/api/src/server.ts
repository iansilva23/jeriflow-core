import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { DependencyReport } from "./infrastructure.ts";
import { identityRoutes, identityRequest, type IdentityApi } from "./identity-http.ts";
import { IdentityError } from "./identity-primitives.ts";

export function createApp(probe: () => Promise<DependencyReport> = async () => ({ database: "not_configured", cache: "not_configured" }), identity?: IdentityApi) {
  let identityRequests = 0;
  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Referrer-Policy", "no-referrer");
    const send = (status: number, body: object) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status); res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
    };
    let path: string;
    try { path = new URL(req.url ?? "/", "http://localhost").pathname; }
    catch { send(400, { error: "BAD_REQUEST", requestId }); return; }
    const health = ["/health/live", "/health/ready", "/health/dependencies"].includes(path);
    if (health && !["GET", "HEAD"].includes(req.method ?? "")) {
      res.setHeader("Allow", "GET, HEAD");
      send(405, { error: "METHOD_NOT_ALLOWED", requestId }); return;
    }
    if (path === "/health/live") {
      send(200, { status: "alive", stage: "development-scaffold" }); return;
    }
    if (path === "/health/ready") {
      // Saúde da infraestrutura não é homologação das funcionalidades de negócio.
      send(503, { status: "not_ready", reason: "business_backend_not_completed" }); return;
    }
    if (path === "/health/dependencies") {
      try {
        const dependencies = await probe();
        send(dependencies.database === "ready" && dependencies.cache === "ready" ? 200 : 503, dependencies);
      } catch {
        send(503, { database: "unavailable", cache: "unavailable" });
      }
      return;
    }
    if (Object.hasOwn(identityRoutes, path)) {
      if (identityRequests >= 32) { res.setHeader("Retry-After", "1"); send(503, { error: "AUTH_BUSY", requestId }); return; }
      identityRequests++;
      try { send(200, await identityRequest(req, res, identity, requestId)); }
      catch (error) {
        const known = error instanceof IdentityError;
        if (known && error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
        if (known && error.status === 401) res.setHeader("WWW-Authenticate", "Bearer");
        res.setHeader("Connection", "close");
        req.resume();
        send(known ? error.status : 503, { error: known ? error.code : "IDENTITY_UNAVAILABLE", requestId });
      } finally { identityRequests--; }
      return;
    }
    if (path === "/api/v1" || path.startsWith("/api/v1/")) {
      send(503, { error: "NOT_IMPLEMENTED", requestId }); return;
    }
    send(404, { error: "NOT_FOUND", requestId });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}
