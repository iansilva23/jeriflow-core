import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { adminPanels } from "../packages/contracts/src/catalog.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reservation = createServer();
await new Promise(resolvePort => reservation.listen(0, "127.0.0.1", resolvePort));
const port = reservation.address().port;
await new Promise(resolveClose => reservation.close(resolveClose));
const child = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: resolve(root, "apps/admin"), stdio: ["ignore", "pipe", "pipe"], shell: false,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", JERIFLOW_ADMIN_ORIGIN: `http://127.0.0.1:${port}` },
});
let startupError = false;
let logs = "";
child.on("error", () => { startupError = true; });
for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { logs = (logs + b.toString()).slice(-8000); });
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (startupError || child.exitCode !== null || child.signalCode !== null) throw new Error("Servidor administrativo não iniciou.");
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(500) });
      await response.arrayBuffer();
      if (response.ok) { ready = true; break; }
    } catch { /* Prazo total limitado; falhas de inicialização não são aprovação. */ }
    await delay(100);
  }
  assert(ready, "Servidor não ficou disponível no prazo.");
  const index = await fetch(base + "/entrar", { signal: AbortSignal.timeout(10_000) });
  const html = await index.text();
  assert.equal(index.status, 200);
  assert.equal(index.headers.get("x-powered-by"), null);
  assert(html.includes("Cada área protegida"));
  for (const path of ["/", ...adminPanels.map(panel => "/paineis/" + panel.id), "/paineis/turismo/tts"]) {
    const page = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    await page.arrayBuffer();
    assert.equal(page.status, 307, path);
    assert.equal(page.headers.get("location"), "/entrar");
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    console.log("ACESSO ANÔNIMO BLOQUEADO:", path);
  }
  for (const path of ["/paineis/inexistente", "/paineis/fiscal-tts", "/paineis/transporte", "/inexistente"]) {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(10_000) });
    await response.arrayBuffer();
    assert.equal(response.status, 404, path);
  }
  const session = await fetch(base + "/api/identity/auth/me");
  assert.equal(session.status, 401); assert.equal(session.headers.get("cache-control"), "no-store");
  console.log("Login, índice protegido, sete painéis, área TTS e rotas inválidas aprovados via HTTP.");
} catch (error) {
  console.error(error.message);
  console.error(logs);
  process.exitCode = 1;
} finally {
  if (!startupError && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolveExit => child.once("exit", resolveExit));
    child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(kill);
  }
}
