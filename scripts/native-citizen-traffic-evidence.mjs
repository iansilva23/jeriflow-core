import assert from "node:assert/strict";

export function createCitizenTrafficCaptureV516({ fixture, packageIdentifier, readHierarchy, capture, record }) {
  assert.match(fixture?.email ?? "", /^[a-z0-9-]+@example\.invalid$/, "Captura exige fixture fictícia");
  assert.match(fixture.password ?? "", /^[a-f0-9]{48}$/, "Credencial sintética inválida");
  assert.match(fixture.citizenPassword ?? "", /^[a-zA-Z0-9]{15,64}$/, "Credencial Cidadão sintética inválida");
  assert.equal(packageIdentifier, "com.example.jeriflow.cidadao");
  return async step => {
    assert(["form-filled", "photo-preview", "protocol-confirmed"].includes(step));
    const hierarchy = await readHierarchy();
    assert(hierarchy.includes(`package="${packageIdentifier}"`), "Captura exige formulário Cidadão em primeiro plano");
    assert(!hierarchy.includes(fixture.password) && !hierarchy.includes(fixture.citizenPassword), "Captura recusada: campo de credencial ainda preenchido");
    const evidence = await capture(step, hierarchy);
    await record(evidence);
  };
}
