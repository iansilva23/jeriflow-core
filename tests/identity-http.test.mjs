import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp } from "../apps/api/src/server.ts";

test("HTTP de identidade recusa origem externa, token em URL, conteúdo incorreto e corpo excessivo antes da operação", async () => {
  let calls = 0;
  const api = { login: async () => { calls++; return {}; }, me: async () => { calls++; return {}; }, access: async () => { calls++; return {}; }, logout: async () => { calls++; } };
  const server = createApp(undefined, api);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    for (const [path, options, status] of [
      ["/auth/login", { method: "POST", headers: { Origin: "https://outside.invalid" } }, 403],
      ["/auth/login", { method: "GET" }, 405],
      ["/auth/login", { method: "POST", body: "{}" }, 415],
      ["/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(8193) }, 413],
      ["/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }, 400],
      ["/auth/me", {}, 401],
      ["/auth/me?token=secret", {}, 400],
      ["/auth/email/confirm", {}, 405],
      ["/auth/password/reset?token=secret", { method: "POST" }, 400],
      ["/auth/email/request", { method: "POST", headers: { Origin: "https://outside.invalid" } }, 403],
      ["/auth/password/request", { method: "POST", body: "{}" }, 415],
      ["/auth/mfa/enroll/start", { method: "POST" }, 401],
      ["/auth/mfa/enroll/confirm", { method: "POST" }, 401],
      ["/auth/mfa/challenge", { method: "POST" }, 401],
      ["/auth/mfa/recovery-codes", { method: "POST" }, 401],
      ["/management/query", { method: "POST" }, 401],
      ["/management/mutate", { method: "POST" }, 401],
      ["/auth/public-profile", { method: "POST" }, 401],
      ["/auth/registration/complete?token=secret", { method: "POST" }, 400],
      ["/auth/registration/request", { method: "POST", headers: { Origin: "https://outside.invalid" } }, 403],
      ["/access?permission=a&permission=b", { headers: { Authorization: "Bearer " + randomBytes(32).toString("base64url") } }, 400],
    ]) {
      const r = await fetch(url + "/api/v1" + path, options);
      assert.equal(r.status, status, path); assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(r.headers.get("access-control-allow-origin"), null); await r.json();
    }
    assert.equal(calls, 0);
    api.me = async () => { throw new Error("private-database-credentials"); };
    const failure = await fetch(url + "/api/v1/auth/me", { headers: { Authorization: "Bearer " + randomBytes(32).toString("base64url") } });
    assert.equal(failure.status, 503); assert(!(await failure.text()).includes("private"));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
