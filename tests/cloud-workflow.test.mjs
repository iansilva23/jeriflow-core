import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../.github/workflows/check.yml", import.meta.url), "utf8"));

test("CI tem início manual, limite de execução e ações oficiais fixadas por commit", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const job = workflow.jobs.foundation;
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 20);
  const actions = job.steps.filter(step => step.uses);
  assert.equal(actions.length, 3);
  for (const step of actions) {
    assert.match(step.uses, /^actions\/(checkout|setup-node|upload-artifact)@[a-f0-9]{40}$/);
  }
  assert.equal(actions.find(step => step.uses.startsWith("actions/checkout@")).with["persist-credentials"], false);
  assert.equal(actions.find(step => step.uses.startsWith("actions/setup-node@")).with["node-version"], "24.19.0");
});

test("CI remove relatório antigo e publica somente a evidência nova, sem segredos ou logs", () => {
  const steps = workflow.jobs.foundation.steps;
  const verification = steps.findIndex(step => step.id === "verification");
  const cleanup = steps.findIndex(step => step.run?.includes('rmSync("docs/VERIFICATION.json"'));
  assert(cleanup >= 0 && cleanup < verification);
  const upload = steps.find(step => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload.with.path, "docs/VERIFICATION.json");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(upload.with["retention-days"], 3);
  assert(upload.if.includes("steps.verification.outcome != 'skipped'"));
  assert(upload.if.includes("hashFiles('docs/VERIFICATION.json') != ''"));
  assert(upload.with.name.includes("github.sha"));
  assert(upload.with.name.includes("github.run_id"));
  assert(upload.with.name.includes("github.run_attempt"));
  const shutdown = steps.find(step => step.run === "npm run infra:down");
  assert(shutdown.if.includes("always()"));
  assert(shutdown.if.includes("steps.infrastructure.outcome != 'skipped'"));
});
