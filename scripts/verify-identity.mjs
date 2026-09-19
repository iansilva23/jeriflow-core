import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = resolve(root, "artifacts/identity");
mkdirSync(directory, { recursive: true });
const report = { scope: "identity-security-with-real-postgresql-redis-mailpit", productionApproved: false,
  coverage: ["identity-core", "email-verification", "password-recovery", "admin-mfa", "local-email-delivery", "four-mobile-auth-controllers", "admin-cookie-bff", "seven-protected-panels", "tts-admin-separation"],
  externalEmailDelivery: false, mobileAndAdminScreensConnected: true,
  nativeSecureStorageOnDeviceTested: false, interactiveBrowserTested: false,
  startedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  runId: process.env.GITHUB_RUN_ID ?? null, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  lockfileSha256: createHash("sha256").update(readFileSync(resolve(root, "package-lock.json"))).digest("hex"),
  node: process.version, status: "running" };
writeFileSync(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
const result = await new Promise(resolveResult => {
  let output = "";
  const child = spawn(process.execPath, ["--test", "--test-reporter=tap", "tests/integration/identity.test.mjs"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: false, timeout: 180_000 });
  const capture = chunk => { output = (output + chunk.toString()).slice(-1_000_000); };
  child.stdout.on("data", capture); child.stderr.on("data", capture);
  child.on("error", () => resolveResult({ code: 1, output: "Test runner unavailable" }));
  child.on("close", code => resolveResult({ code: code ?? 1, output }));
});
writeFileSync(resolve(directory, "integration.log"), result.output);
const tests = Number(result.output.match(/^# tests (\d+)$/m)?.[1] ?? 0);
const passed = Number(result.output.match(/^# pass (\d+)$/m)?.[1] ?? 0);
const failed = Number(result.output.match(/^# fail (\d+)$/m)?.[1] ?? 0);
Object.assign(report, { finishedAt: new Date().toISOString(), tests, passed, failed, exitCode: result.code,
  status: result.code === 0 && tests > 0 && tests === passed && failed === 0 ? "passed" : "failed" });
if (report.status === "failed") {
  let diagnostic = result.output;
  try {
    const env = parseEnv(readFileSync(resolve(root, ".env.local"), "utf8"));
    const secrets = [env.DATABASE_URL, env.REDIS_URL,
      new URL(env.DATABASE_URL).password, new URL(env.REDIS_URL).password,
      readFileSync(resolve(root, ".secrets/postgres-owner-password"), "utf8").trim(),
      readFileSync(resolve(root, ".secrets/identity-key"), "utf8").trim()];
    for (const secret of secrets.filter(Boolean)) diagnostic = diagnostic.replaceAll(secret, "[REDACTED]");
    // Inclui segredos aleatórios dos fixtures, não apenas credenciais da infra.
    report.diagnostic = diagnostic.replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[REDACTED_VALUE]")
      .replace(/otpauth:\/\/[^\s'"<>]+/g, "[REDACTED_URI]").slice(-16000);
  } catch { report.diagnostic = "Diagnóstico detalhado retido: configuração de redação indisponível."; }
}
writeFileSync(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
// Publicar só nomes dos cenários e contagens; erros detalhados ficam no log local.
for (const line of result.output.split("\n")) if (/^\s*(# Subtest:|(?:not )?ok \d+|# (?:tests|pass|fail) \d+)/.test(line)) console.log(line);
console.log("Identidade com bancos reais: " + report.status.toUpperCase());
process.exitCode = report.status === "passed" ? 0 : 1;
