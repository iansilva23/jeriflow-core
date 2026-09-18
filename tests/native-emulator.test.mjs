import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertAndroidHome, assertNoSystemUiAnr, createAndroidReadiness, createAndroidHierarchyReader, prepareAndroidHome } from "../scripts/native-emulator.mjs";

test("estabilidade exige amostras contínuas; falha ou reinício do System UI recomeça a contagem", () => {
  const gate = createAndroidReadiness();
  assert.equal(gate.observe("123", 0).ready, false);
  assert.equal(gate.observe("123", 31_000).ready, false, "Só duas amostras não bastam");
  assert.equal(gate.observe("123", 33_000).ready, true);
  gate.reset();
  assert.equal(gate.observe("123", 50_000).ready, false);
  gate.observe("123", 80_000);
  assert.equal(gate.observe("456", 83_000).ready, false, "Novo PID exige novo período estável");
  gate.observe("456", 100_000);
  assert.equal(gate.observe("456", 114_000).ready, true);
  assert.throws(() => gate.observe("", 115_000));
});

test("capturas não reutilizam XML antigo nem aceitam sucesso sem uma tela nova", async () => {
  const files = new Map();
  const dumps = [];
  let mode = "success";
  const read = createAndroidHierarchyReader(async args => {
    const path = args.at(-1);
    if (args[1] === "uiautomator") {
      dumps.push(path);
      if (mode === "explicitError") return "ERROR: could not get idle state.";
      if (mode === "success") files.set(path, '<hierarchy><node package="com.android.launcher3"/></hierarchy>');
      return "";
    }
    if (args[1] === "cat") { assert(files.has(path), "XML novo ausente"); return files.get(path); }
    if (args[1] === "rm") files.delete(path);
    return "";
  });
  assert.match(await read(), /hierarchy/);
  files.set(dumps[0], '<hierarchy><node text="captura obsoleta"/></hierarchy>');
  mode = "silentFailure";
  await assert.rejects(read(), /XML novo ausente/);
  mode = "explicitError";
  await assert.rejects(read(), /could not get idle state/);
  mode = "success";
  assert.match(await read(), /launcher3/);
  assert.equal(new Set(dumps).size, 4);
});

test("alerta invisível impede prontidão sem encerrar prematuramente a inicialização", () => {
  const failed = JSON.parse(readFileSync(new URL("../docs/evidence/native-35372117436/android/report.json", import.meta.url), "utf8"));
  assert.throws(() => assertNoSystemUiAnr(failed.androidDiagnostics.windows), error => error.systemUiBootFailure === true && error.fatal === false);
  const visible = JSON.parse(readFileSync(new URL("../docs/evidence/native-35373594989/android/cidadao/attempt-1/report.json", import.meta.url), "utf8"));
  assert.throws(() => assertNoSystemUiAnr(visible.androidDiagnostics.windows), error => error.systemUiBootFailure === true && error.fatal === true);
  assert.throws(() => assertNoSystemUiAnr('Window #0 Window{ Application Not Responding: com.android.systemui }:\n  Window #1 Window{ outra }:\n isOnScreen=false\n isVisible=false\n Surface: shown=false'), error => error.fatal === true,
    'Visibilidade de outra janela não pode ocultar ANR');
  assertNoSystemUiAnr("Application Not Responding: com.example.jeriflow.cidadao");
  assertNoSystemUiAnr("Window{ com.android.systemui StatusBar }");
});

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
