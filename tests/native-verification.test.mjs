import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { mobileApps } from "../packages/contracts/src/catalog.ts";
import { assertAppScreen, assertAndroidManifest, selectIPhone } from "../scripts/native-assertions.mjs";

test("verificação nativa rejeita splash, tela errada e ausência do aviso de desenvolvimento", () => {
  assert.throws(() => assertAppScreen("JeriFlow", "JeriFlow Cidadão"));
  assert.throws(() => assertAppScreen("JeriFlow Turista Ambiente de desenvolvimento Não use dados reais", "JeriFlow Cidadão"));
  assert.throws(() => assertAppScreen("JeriFlow Cidadão", "JeriFlow Cidadão"));
  assertAppScreen("JeriFlow Cidadao\nAmbiente de desenvolvimento — Etapa 2\nNao use dados reais.", "JeriFlow Cidadão");
});

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

test("CI nativo é manual, limitado e publica somente relatórios e imagens", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/native.yml", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const job = workflow.jobs.native;
  assert.equal(job["timeout-minutes"], 55);
  assert.deepEqual(job.strategy.matrix.include.map(entry => entry.platform).sort(), ["android", "ios"]);
  assert.equal(job.strategy["fail-fast"], false);
  assert.equal(job.strategy["max-parallel"], 2);
  for (const step of job.steps.filter(step => step.uses)) assert.match(step.uses, /^actions\/(checkout|setup-node|upload-artifact)@[a-f0-9]{40}$/);
  assert.equal(job.steps.find(step => step.uses?.startsWith("actions/checkout@")).with["persist-credentials"], false);
  const upload = job.steps.find(step => step.uses?.startsWith("actions/upload-artifact@"));
  assert.deepEqual(upload.with.path.trim().split("\n"), ["report.json", "*.png", "*.ui.json"].map(name => "artifacts/native/${{ matrix.platform }}/" + name));
  assert.equal(upload.with["retention-days"], 3);
  assert(upload.if.includes("always()"));
});
