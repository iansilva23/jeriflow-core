import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../apps/api/src/server.ts";
import { createDependencyProbe } from "../apps/api/src/infrastructure.ts";

// Falhas de transporte reais em sockets locais. Não simula um banco aprovado.
async function endpoint(t, reset = false) {
  const sockets = new Set();
  let count = 0;
  let connected;
  const connection = new Promise(resolve => { connected = resolve; });
  const server = createServer(socket => {
    count++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", () => {});
    connected();
    if (reset) socket.destroy();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { port: server.address().port, connection, count: () => count, open: () => sockets.size };
}

async function api(t, database, cache) {
  const probe = createDependencyProbe({
    databaseUrl: `postgresql://jeriflow_app:fictitious-test@127.0.0.1:${database.port}/jeriflow_dev`,
    redisUrl: `redis://:fictitious-test@127.0.0.1:${cache.port}`,
  });
  const server = createApp(probe);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return "http://127.0.0.1:" + server.address().port;
}

test("Dependências sem resposta: prazo limitado, processo vivo e sondas simultâneas agrupadas", { timeout: 15_000 }, async t => {
  const database = await endpoint(t);
  const cache = await endpoint(t);
  const base = await api(t, database, cache);
  const start = performance.now();
  const checks = Array.from({ length: 12 }, async () => {
    const response = await fetch(base + "/health/dependencies", { signal: AbortSignal.timeout(7000) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { database: "unavailable", cache: "unavailable" });
  });
  await Promise.all([database.connection, cache.connection]);
  const live = await fetch(base + "/health/live", { signal: AbortSignal.timeout(2000) });
  assert.equal(live.status, 200);
  await live.json();
  await Promise.all(checks);
  assert(performance.now() - start < 6500, "Sonda ultrapassou o prazo de falha esperado");
  assert.equal(database.count(), 1);
  assert.equal(cache.count(), 1);
  for (let retry = 0; retry < 10 && (database.open() || cache.open()); retry++) await delay(50);
  assert.equal(database.open() + cache.open(), 0, "Sonda deixou sockets presos");
  const warm = await fetch(base + "/health/dependencies", { signal: AbortSignal.timeout(2000) });
  assert.equal(warm.status, 503);
  await warm.json();
  assert.equal(database.count(), 1);
  assert.equal(cache.count(), 1);
  await delay(1100);
  const retry = await fetch(base + "/health/dependencies", { signal: AbortSignal.timeout(7000) });
  assert.equal(retry.status, 503);
  await retry.json();
  assert.equal(database.count(), 2, "A falha ficou em cache indefinidamente");
  assert.equal(cache.count(), 2);
});

test("Conexões interrompidas: erro contido, sem queda da API ou prontidão indevida", { timeout: 7000 }, async t => {
  const database = await endpoint(t, true);
  const cache = await endpoint(t, true);
  const base = await api(t, database, cache);
  const response = await fetch(base + "/health/dependencies", { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { database: "unavailable", cache: "unavailable" });
  const readiness = await fetch(base + "/health/ready", { signal: AbortSignal.timeout(1000) });
  assert.equal(readiness.status, 503);
  await readiness.json();
  const live = await fetch(base + "/health/live", { signal: AbortSignal.timeout(1000) });
  assert.equal(live.status, 200);
  await live.json();
});
