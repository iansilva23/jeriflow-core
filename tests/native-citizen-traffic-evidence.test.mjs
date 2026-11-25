import assert from "node:assert/strict";
import test from "node:test";
import { createCitizenTrafficCaptureV516 } from "../scripts/native-citizen-traffic-evidence.mjs";

const fixture = { email: "capture@example.invalid", password: "a".repeat(48), citizenPassword: "SyntheticCitizen42" };
const packageIdentifier = "com.example.jeriflow.cidadao";
const app = `<node package="${packageIdentifier}" text="Foto da ocorrência" />`;
function scenario(hierarchy = app) {
  const calls = [];
  const options = { fixture, packageIdentifier, readHierarchy: async () => hierarchy,
    capture: async (step, xml) => { calls.push({ kind: "capture", step, xml }); return { step, sha256: "f".repeat(64) }; },
    record: evidence => calls.push({ kind: "record", evidence }) };
  return { calls, options };
}
test("captura sintética mantém fixture no escopo e só registra após capturar", async () => {
  const { calls, options } = scenario();
  const capture = createCitizenTrafficCaptureV516(options);
  for (const step of ["form-filled", "photo-preview", "protocol-confirmed"]) await capture(step);
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map(x => x.kind), ["capture", "record", "capture", "record", "capture", "record"]);
  assert.equal(calls[2].step, "photo-preview");
});
test("fixture ausente ou conta real não permite criar captura", () => {
  const { options } = scenario();
  assert.throws(() => createCitizenTrafficCaptureV516({ ...options, fixture: undefined }), /fixture fictícia/);
  assert.throws(() => createCitizenTrafficCaptureV516({ ...options, fixture: { ...fixture, email: "person@example.org" } }), /fixture fictícia/);
});
test("credenciais preenchidas, outro app ou etapa de login nunca geram artefato", async () => {
  for (const hierarchy of [`${app}<node text="${fixture.password}"/>`, `${app}<node text="${fixture.citizenPassword}"/>`, '<node package="com.android.camera2"/>']) {
    const { calls, options } = scenario(hierarchy);
    await assert.rejects(createCitizenTrafficCaptureV516(options)("photo-preview"));
    assert.equal(calls.length, 0);
  }
  const { calls, options } = scenario();
  await assert.rejects(createCitizenTrafficCaptureV516(options)("login"));
  assert.equal(calls.length, 0);
});
test("falha de captura não produz registro de evidência aprovada", async () => {
  const { calls, options } = scenario();
  options.capture = async () => { throw new Error("Captura indisponível"); };
  await assert.rejects(createCitizenTrafficCaptureV516(options)("form-filled"), /indisponível/);
  assert.equal(calls.length, 0);
});
