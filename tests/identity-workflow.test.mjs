import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
test("CI de identidade exige bancos reais, mantém execução manual e publica relatório limitado", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/identity.yml", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert(workflow.jobs.identity["timeout-minutes"] <= 15);
  const steps = workflow.jobs.identity.steps;
  for (const step of steps.filter(s => s.uses)) assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
  assert(steps.findIndex(s => s.run === "npm run infra:up") < steps.findIndex(s => s.run === "npm run identity:verify"));
  assert(steps.find(s => s.run === "npm run infra:down").if.includes("always()"));
  const upload = steps.find(s => s.uses?.includes("upload-artifact"));
  assert.equal(upload.with.path, "artifacts/identity/report.json");
  assert.equal(upload.with["retention-days"], 3);
});
