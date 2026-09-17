import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pinned = ["exec", "--yes", "--ignore-scripts", "--package=npm@12.0.2", "--", "npm"];
const steps = [
  ["typescript-and-tests", ["run", "check"]],
  ["admin-build", ["run", "build:admin"]],
  ["admin-http", ["run", "test:admin"]],
  ["mobile-bundles", ["run", "build:mobile"]],
  ["dependency-tree", [...pinned, "ls", "--all", "--json"]],
  ["dependency-audit", [...pinned, "audit", "--json", "--audit-level=low"]],
  ["local-configuration", ["run", "local:prepare"]],
  ["local-infrastructure", ["run", "infra:check"]],
];
mkdirSync(resolve(root, "artifacts"), { recursive: true });
const report = {
  startedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  lockfileSha256: createHash("sha256").update(readFileSync(resolve(root, "package-lock.json"))).digest("hex"),
  scope: "Development foundation only; no operational/business feature approval",
  stage2Closed: false,
  nativeBuilds: "NOT_COVERED_BY_THIS_RUNNER",
  physicalDeviceTests: "NOT_COVERED_BY_THIS_RUNNER",
  checks: [],
};
for (const [id, args] of steps) {
  console.log("Verificando:", id);
  const start = Date.now();
  const result = await new Promise(resolveResult => {
    let output = "";
    let error = "";
    const child = spawn("npm", args, { cwd: root, shell: false, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", EXPO_NO_TELEMETRY: "1" }, timeout: 600_000 });
    child.stdout.on("data", value => { output = (output + value).slice(-2_000_000); });
    child.stderr.on("data", value => { error = (error + value).slice(-50_000); });
    child.on("error", () => resolveResult({ code: 1, output, error: "Command could not execute" }));
    child.on("close", code => resolveResult({ code: code ?? 1, output, error }));
  });
  writeFileSync(resolve(root, "artifacts", id + ".log"), result.output + "\n" + result.error);
  const check = { id, command: "npm " + args.join(" "), exitCode: result.code, passed: result.code === 0, durationMs: Date.now() - start };
  if (id === "dependency-audit") {
    try { check.vulnerabilities = JSON.parse(result.output).metadata.vulnerabilities; }
    catch { check.passed = false; check.exitCode = 1; }
  }
  report.checks.push(check);
  console.log(id + ": " + (check.passed ? "APROVADO" : "FALHOU / BLOQUEADO"));
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(root, "docs/VERIFICATION.json"), JSON.stringify(report, null, 2) + "\n");
}
process.exitCode = report.checks.some(check => !check.passed) ? 1 : 0;
console.log("Relatório: docs/VERIFICATION.json. Aprovação desta bateria não encerra a etapa nem libera produção.");
