import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mobileApps } from "../packages/contracts/src/catalog.ts";
import { assertAppScreen } from "../scripts/native-assertions.mjs";
import { waitForNative } from "../scripts/native-process.mjs";

const markers = ["Ambiente de desenvolvimento", "Não use dados reais", "Bem-vindo de volta", "Email", "Senha (15 a 128 caracteres)", "Entrar", "Esqueci minha senha"];

test("abertura exige login completo de cada app, não somente marca ou splash", () => {
  for (const app of mobileApps) {
    const valid = [app.name, ...markers];
    assertAppScreen(valid.join("\n"), app.name);
    assertAppScreen(valid.join("\n").normalize("NFD").replace(/\p{M}/gu, ""), app.name);
    for (const missing of [app.name, ...markers]) {
      assert.throws(() => assertAppScreen(valid.filter(marker => marker !== missing).join("\n"), app.name));
    }
    assert.throws(() => assertAppScreen([app.name, ...markers.slice(0, 2)].join(" "), app.name));
    const other = mobileApps.find(item => item.id !== app.id);
    assert.throws(() => assertAppScreen([other.name, ...markers].join(" "), app.name));
  }
});

test("regressão: captura iOS com falha real no cofre reprova imediatamente", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/native/ios-secure-store-failure.json", import.meta.url), "utf8"));
  let attempts = 0;
  await assert.rejects(waitForNative(() => {
    attempts++;
    assertAppScreen(fixture.recognizedText.join(" "), "JeriFlow Cidadão");
  }, { timeout: 100, interval: 1 }), error => error.fatal === true && /Abertura do app falhou/.test(error.message));
  assert.equal(attempts, 1, "Falha explícita não deve consumir o prazo de abertura");
  for (const failure of ["Conexão indisponível", "Não foi possível acessar o armazenamento protegido"]) {
    assert.throws(() => assertAppScreen([mobileApps[0].name, ...markers, failure].join(" "), mobileApps[0].name), error => error.fatal === true);
  }
});

test("iOS mantém assinatura ad-hoc e verificação, sem exigir credenciais de produção", () => {
  const runner = readFileSync(new URL("../scripts/native-runner.mjs", import.meta.url), "utf8");
  assert(runner.includes('"CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-"'));
  assert(!runner.includes("CODE_SIGNING_ALLOWED=NO"));
  assert(runner.includes('["--verify", "--deep", "--strict", binary]'));
  assert(!runner.includes("-allowProvisioningUpdates"));
  assert(!runner.includes("-allowProvisioningDeviceRegistration"));
  assert(runner.includes('screenExpectation: "anonymous-auth-login-v1"'));
});
