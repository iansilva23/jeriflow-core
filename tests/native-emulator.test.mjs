import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertAndroidHome, prepareAndroidHome } from "../scripts/native-emulator.mjs";

test("preparação reconhece o ANR real de System UI e exige launcher pronto", () => {
  const failed = JSON.parse(readFileSync(new URL("../docs/evidence/native-35342349483/android/cidadao-1.ui.json", import.meta.url), "utf8"));
  assert.throws(() => assertAndroidHome(failed.hierarchy), error => error.systemUiBootFailure === true && error.fatal === true);
  assert.throws(() => assertAndroidHome('<node package="android" text="Lock screen"/>'), /ainda não está pronta/);
  assert.throws(() => assertAndroidHome('<node package="com.android.launcher3" text="JeriFlow isn\'t responding"/>'), error => !error.systemUiBootFailure);
  assertAndroidHome('<node package="com.google.android.apps.nexuslauncher" text="Home"/>');
});

test("reboot só recupera System UI antes da instalação e nunca oculta segunda falha", async () => {
  const events = [];
  let checks = 0;
  const failure = () => Object.assign(new Error("System UI"), { systemUiBootFailure: true });
  await prepareAndroidHome({
    waitForHome: async () => { events.push("check"); if (checks++ === 0) throw failure(); },
    recordRecovery: async () => events.push("evidence"),
    reboot: async () => events.push("reboot"),
  });
  assert.deepEqual(events, ["check", "evidence", "reboot", "check"]);
  let reboots = 0;
  await assert.rejects(prepareAndroidHome({ waitForHome: async () => { throw failure(); }, recordRecovery: async () => {}, reboot: async () => { reboots++; } }), /System UI/);
  assert.equal(reboots, 1);
  await assert.rejects(prepareAndroidHome({ waitForHome: async () => { throw new Error("App travou"); }, recordRecovery: async () => assert.fail(), reboot: async () => assert.fail() }), /App travou/);
});
