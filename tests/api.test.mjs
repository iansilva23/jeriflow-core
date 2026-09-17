import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createApp } from "../apps/api/src/server.ts";

async function withServer(probe, operation) {
  const server = createApp(probe);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await operation("http://127.0.0.1:" + server.address().port, server); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test("API: consulta de saúde aceita query e HEAD, sem habilitar operações", async () => {
  await withServer(undefined, async (url, server) => {
    const first = await fetch(url + "/health/live?check=1");
    assert.equal(first.status, 200);
    const id = first.headers.get("x-request-id");
    await first.json();
    const head = await fetch(url + "/health/live", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.notEqual(head.headers.get("x-request-id"), id);
    for (const path of ["/api/v1", "/api/v1/tts/verify", "/api/v1/admin/mestre"]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const r = await fetch(url + path, { method, headers: { Origin: "https://untrusted.invalid" } });
        assert.equal(r.status, 503);
        assert.equal(r.headers.get("access-control-allow-origin"), null);
        assert.equal((await r.json()).error, "NOT_IMPLEMENTED");
      }
    }
    assert.equal(server.headersTimeout, 10_000);
    assert.equal(server.requestTimeout, 15_000);
    assert.equal(server.maxRequestsPerSocket, 100);
  });
});

test("API: banco disponível não é prontidão operacional", async () => {
  await withServer(async () => ({ database: "ready", cache: "ready" }), async url => {
    const dependencies = await fetch(url + "/health/dependencies");
    assert.equal(dependencies.status, 200);
    assert.deepEqual(await dependencies.json(), { database: "ready", cache: "ready" });
    const readiness = await fetch(url + "/health/ready");
    assert.equal(readiness.status, 503);
    assert.match((await readiness.json()).reason, /identity/);
  });
});

test("API: falha da dependência é contida, sem revelar mensagens ou credenciais", async () => {
  await withServer(async () => { throw new Error("fake-private-password"); }, async url => {
    const response = await fetch(url + "/health/dependencies");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { database: "unavailable", cache: "unavailable" });
    const alive = await fetch(url + "/health/live");
    assert.equal(alive.status, 200);
    await alive.json();
    const denied = await fetch(url + "/health/dependencies", { method: "POST" });
    assert.equal(denied.status, 405);
    assert.equal(denied.headers.get("allow"), "GET, HEAD");
    await denied.json();
  });
});

for (const value of ["0", "1023", "65536", "3e3", "3001abc", "3001.5"]) {
  test("Inicialização recusa PORT inválido: " + value, () => {
    const result = spawnSync(process.execPath, ["apps/api/src/main.ts"], { cwd: new URL("..", import.meta.url),
      env: { ...process.env, NODE_ENV: "development", DATABASE_URL: "", REDIS_URL: "", PORT: value }, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PORT deve ser/);
  });
}
test("Inicialização recusa produção nesta etapa", () => {
  const result = spawnSync(process.execPath, ["apps/api/src/main.ts"], { cwd: new URL("..", import.meta.url),
    env: { ...process.env, NODE_ENV: "production", PORT: "3001", DATABASE_URL: "", REDIS_URL: "" }, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /não está liberado para produção/);
});
