import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { mobileApps } from "../packages/contracts/src/catalog.ts";
import { assertAndroidManifest, selectIPhone } from "../scripts/native-assertions.mjs";
import { nativeMatrix } from "../scripts/native-matrix.mjs";

test("APK precisa preservar identidade, bloqueio de backup e permissões em todos os apps", () => {
  for (const app of mobileApps) {
    const config = JSON.parse(readFileSync(new URL(`../apps/${app.id}/app.json`, import.meta.url))).expo.android;
    assert(config.blockedPermissions.includes("android.permission.SYSTEM_ALERT_WINDOW"));
    const valid = `<manifest package="${config.package}"><application android:allowBackup="false"/></manifest>`;
    assertAndroidManifest(valid, config);
    assert.throws(() => assertAndroidManifest(valid.replace(config.package, "outro.app"), config));
    assert.throws(() => assertAndroidManifest(valid.replace('allowBackup="false"', 'allowBackup="true"'), config));
    assert.throws(() => assertAndroidManifest(valid.replace('<application ', '<application android:debuggable="true" '), config));
    for (const permission of config.blockedPermissions) {
      assert.throws(() => assertAndroidManifest(valid.replace("<application", `<uses-permission android:name="${permission}"/><application`), config));
    }
  }
});

test("seleção de simulador recusa dispositivo indisponível ou de outra plataforma", () => {
  const available = { name: "iPhone 17", udid: "test-only", isAvailable: true, state: "Shutdown" };
  const devices = { "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [{ ...available, isAvailable: false }, available] };
  assert.equal(selectIPhone(devices).udid, available.udid);
  assert.throws(() => selectIPhone({ "com.apple.CoreSimulator.SimRuntime.tvOS-26-5": [available] }));
  assert.throws(() => selectIPhone({ "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [{ ...available, isAvailable: false }] }));
});

test("CI nativo isola compilação e abertura, com transferência de APK verificada", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/native.yml", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.on.workflow_dispatch.inputs.platform.default, "android");
  assert.equal(workflow.on.workflow_dispatch.inputs.app.default, "all");
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.app.options.slice(1), mobileApps.map(app => app.id));
  const plan = workflow.jobs.plan;
  assert.equal(plan["timeout-minutes"], 5);
  assert(plan.steps.some(step => step.run === "node --test tests/native-process.test.mjs tests/native-storage.test.mjs tests/native-artifact.test.mjs tests/native-emulator.test.mjs tests/native-auth-screen.test.mjs"));
  const job = workflow.jobs.native;
  assert.equal(job.needs, "plan");
  assert.equal(job["timeout-minutes"], "${{ matrix.jobMinutes }}");
  assert.equal(job.strategy.matrix, "${{ fromJSON(needs.plan.outputs.matrix) }}");
  assert.equal(job.steps.find(step => step.id === "native")["timeout-minutes"], "${{ matrix.stepMinutes }}");
  assert.equal(job.strategy["fail-fast"], false);
  assert.equal(job.strategy["max-parallel"], 4);
  const smoke = workflow.jobs["android-smoke"];
  assert.deepEqual(smoke.needs, ["plan", "native"]);
  assert.equal(smoke["timeout-minutes"], 15);
  assert.equal(smoke.strategy["max-parallel"], 4);
  assert.equal(smoke.strategy["fail-fast"], false);
  assert(smoke.if.includes("!cancelled()"));
  assert.equal(smoke.steps.find(step => step.id === "smoke")["timeout-minutes"], 12);
  assert(!smoke.steps.some(step => /npm/.test(step.run ?? "")), "Emulador não deve instalar dependências de compilação");
  for (const step of [...plan.steps, ...job.steps, ...smoke.steps].filter(step => step.uses)) assert.match(step.uses, /^actions\/(checkout|setup-node|upload-artifact|download-artifact)@[a-f0-9]{40}$/);
  assert.equal(job.steps.find(step => step.uses?.startsWith("actions/checkout@")).with["persist-credentials"], false);
  const transfers = job.steps.filter(step => step.uses?.startsWith("actions/upload-artifact@"));
  const transfer = transfers[0];
  const download = smoke.steps.find(step => step.uses?.startsWith("actions/download-artifact@"));
  assert.equal(download.with.name.replace("inputs.build_commit || ", "").replace("inputs.build_run_id || ", ""), transfer.with.name);
  assert.deepEqual(smoke.permissions, { contents: "read", actions: "read" });
  assert.equal(download.with["run-id"], "${{ inputs.build_run_id || github.run_id }}");
  assert.equal(workflow.on.workflow_dispatch.inputs.build_commit.default, "");
  assert.equal(workflow.on.workflow_dispatch.inputs.build_run_id.default, "");
  assert.equal(transfer.with["retention-days"], 1);
  assert.deepEqual(transfer.with.path.trim().split("\n"), ["verified.apk", "report.json"].map(name => "artifacts/native/android/${{ matrix.app }}/" + name));
  assert.equal(download.with["digest-mismatch"], "error");
  const upload = transfers[1];
  assert.deepEqual(upload.with.path.trim().split("\n"), ["report.json", "*.png", "*.ui.json"].map(name => "artifacts/native/${{ matrix.platform }}/${{ matrix.app }}/" + name));
  assert.equal(upload.with["retention-days"], 3);
  assert(upload.if.includes("always()"));
  const smokeEvidence = smoke.steps.find(step => step.uses?.startsWith("actions/upload-artifact@"));
  assert(smokeEvidence.if.includes("always()"));
  assert(!smokeEvidence.with.path.includes("*.apk"));
});

test("matriz cobre os quatro Android separadamente e permite diagnóstico de um app", () => {
  const android = nativeMatrix("android", "all").include;
  assert.deepEqual(android.map(entry => entry.app), mobileApps.map(app => app.id));
  assert(android.every(entry => entry.platform === "android" && entry.runner === "ubuntu-24.04" && entry.jobMinutes === 35 && entry.stepMinutes === 30));
  for (const app of mobileApps) assert.deepEqual(nativeMatrix("android", app.id).include.map(entry => entry.app), [app.id]);
  const all = nativeMatrix("all", "all").include;
  assert.equal(all.length, 5);
  assert.deepEqual(all.filter(entry => entry.platform === "ios"), nativeMatrix("ios", "all").include);
  assert.throws(() => nativeMatrix("windows", "all"));
  assert.throws(() => nativeMatrix("android", "app-inexistente"));
  assert.throws(() => nativeMatrix("ios", "cidadao"));
});
