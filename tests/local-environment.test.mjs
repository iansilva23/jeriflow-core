import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync, symlinkSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { prepareLocalEnvironment } from "../scripts/local-environment.mjs";
import { readLocalConfiguration, createDependencyProbe } from "../apps/api/src/infrastructure.ts";

test("Preparação local gera senhas distintas, protege arquivos e preserva a configuração", () => {
  const dir = mkdtempSync(join(tmpdir(), "jeriflow-env-test-"));
  try {
    assert.equal(prepareLocalEnvironment(dir), "created");
    const env = readFileSync(join(dir, ".env.local"), "utf8");
    const owner = readFileSync(join(dir, ".secrets/postgres-owner-password"), "utf8").trim();
    const app = readFileSync(join(dir, ".secrets/postgres-app-password"), "utf8").trim();
    assert.match(owner, /^[a-f0-9]{64}$/);
    assert.match(app, /^[a-f0-9]{64}$/);
    assert.notEqual(owner, app);
    assert(!env.includes(owner));
    const values = Object.fromEntries(env.split("\n").filter(s => /^[A-Z_]+=/.test(s)).map(s => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]));
    assert(readLocalConfiguration(values));
    assert.equal(statSync(join(dir, ".secrets")).mode & 0o777, 0o700);
    assert.equal(statSync(join(dir, ".env.local")).mode & 0o777, 0o600);
    assert.equal(prepareLocalEnvironment(dir), "preserved");
    assert.equal(readFileSync(join(dir, ".env.local"), "utf8"), env);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("Preparação local não sobrescreve arquivo do responsável", () => {
  const dir = mkdtempSync(join(tmpdir(), "jeriflow-env-test-"));
  try {
    writeFileSync(join(dir, ".env.local"), "existing-user-content");
    assert.throws(() => prepareLocalEnvironment(dir), /parcial ou inválida/);
    assert.equal(readFileSync(join(dir, ".env.local"), "utf8"), "existing-user-content");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("Preparação local recusa symlink sem criar arquivos parciais", () => {
  const dir = mkdtempSync(join(tmpdir(), "jeriflow-env-test-"));
  try {
    symlinkSync(join(dir, "missing"), join(dir, ".env.local"));
    assert.throws(() => prepareLocalEnvironment(dir));
    assert.equal(existsSync(join(dir, ".secrets")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("Preparação local recusa valor de conexão substituído mesmo preservando a URL anterior em comentário", () => {
  const dir = mkdtempSync(join(tmpdir(), "jeriflow-env-test-"));
  try {
    prepareLocalEnvironment(dir);
    const path = join(dir, ".env.local");
    const previous = readFileSync(path, "utf8");
    writeFileSync(path, previous + "\nDATABASE_URL=postgresql://external.invalid/other\n");
    assert.throws(() => prepareLocalEnvironment(dir), /inconsistente/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("Preparação local recusa permissões que exponham segredos a outros usuários", () => {
  const dir = mkdtempSync(join(tmpdir(), "jeriflow-env-test-"));
  try {
    prepareLocalEnvironment(dir);
    chmodSync(join(dir, ".env.local"), 0o644);
    assert.throws(() => prepareLocalEnvironment(dir), /Permissões locais excessivas/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Configuração recusa host externo, usuário administrador, parâmetros extras e senhas ausentes", () => {
  const env = { DATABASE_URL: "postgresql://jeriflow_app:fake-test-secret@127.0.0.1:55432/jeriflow_dev", REDIS_URL: "redis://:fake-test-secret@127.0.0.1:56379" };
  assert(readLocalConfiguration(env));
  assert.equal(readLocalConfiguration({}), undefined);
  const bad = [
    { ...env, NODE_ENV: "production" },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace("127.0.0.1", "example.com") },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace("jeriflow_app", "postgres") },
    { ...env, DATABASE_URL: env.DATABASE_URL + "?host=example.com" },
    { ...env, DATABASE_URL: env.DATABASE_URL.replace(":fake-test-secret", "") },
    { ...env, REDIS_URL: "" },
    { ...env, REDIS_URL: env.REDIS_URL + "/3" },
  ];
  for (const value of bad) {
    assert.throws(() => readLocalConfiguration(value), error => {
      assert(!error.message.includes("fake-test-secret")); return true;
    });
  }
});
test("Sonda sem configuração não inventa conectividade", async () => {
  assert.deepEqual(await createDependencyProbe(undefined)(), { database: "not_configured", cache: "not_configured" });
});
test("Configuração Compose é sintaticamente válida, local, persistente e sem senhas embutidas", () => {
  const path = new URL("../infra/compose.yaml", import.meta.url);
  const config = parse(readFileSync(path, "utf8"));
  assert.deepEqual(Object.keys(config.services), ["postgres", "redis"]);
  for (const service of Object.values(config.services)) {
    assert.match(service.image, /:\d+\.\d+(\.\d+)?-bookworm$/);
    assert(service.ports.every(port => port.startsWith("127.0.0.1:")));
    assert(service.healthcheck);
    assert(service.mem_limit);
  }
  assert(!JSON.stringify(config).includes("POSTGRES_HOST_AUTH_METHOD"));
  for (const secret of Object.values(config.secrets)) {
    assert.equal(dirname(resolve(dirname(fileURLToPath(path)), secret.file)), fileURLToPath(new URL("../.secrets", import.meta.url)));
  }
  const init = readFileSync(new URL("../infra/init.sql", import.meta.url), "utf8");
  assert.match(init, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(init, /REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
});
