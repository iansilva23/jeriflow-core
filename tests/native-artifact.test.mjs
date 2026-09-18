import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadNativeBuild } from "../scripts/native-artifact.mjs";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "jeriflow-artifact-test-"));
  const bytes = Buffer.from([80, 75, 3, 4, 0, 255]);
  const expected = { commit: "a".repeat(40), runId: "123", appId: "cidadao", packageIdentifier: "com.example.jeriflow.cidadao", lockfileSha256: "b".repeat(64), templateIntegrity: "sha512-fixture" };
  const report = { schemaVersion: 3, stage: "build", platform: "android", status: "compiled", commit: expected.commit, runId: expected.runId, attempt: "1", lockfileSha256: expected.lockfileSha256, template: { integrity: expected.templateIntegrity }, selectedAppIds: [expected.appId], apps: [{ id: expected.appId, status: "compiled", packageIdentifier: expected.packageIdentifier, build: { configuration: "Release", architectures: ["arm64-v8a", "x86_64"], manifestChecked: true, embeddedJavaScript: true, sha256: createHash("sha256").update(bytes).digest("hex") } }] };
  const save = () => writeFileSync(join(directory, "report.json"), JSON.stringify(report));
  writeFileSync(join(directory, "verified.apk"), bytes); save();
  return { directory, expected, report, save };
}

test("transferência conserva bytes e vincula APK à execução sem inventar abertura", () => {
  const f = fixture();
  try {
    const build = loadNativeBuild(f.directory, f.expected);
    assert.deepEqual(readFileSync(build.apk), Buffer.from([80, 75, 3, 4, 0, 255]));
    assert.equal(build.source.runId, "123");
    assert.equal(build.source.attempt, "1");
    assert.equal(build.launches, undefined);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("teste isolado recusa app, commit, execução, dependências e build divergentes", () => {
  const f = fixture();
  try {
    for (const field of ["commit", "runId", "appId", "packageIdentifier", "lockfileSha256", "templateIntegrity"]) {
      assert.throws(() => loadNativeBuild(f.directory, { ...f.expected, [field]: "outro" }));
    }
    for (const status of ["running", "failed", "passed"]) {
      f.report.status = status; f.save();
      assert.throws(() => loadNativeBuild(f.directory, f.expected), /Build não foi concluído/);
    }
    f.report.status = "compiled";
    f.report.apps[0].build.architectures = ["x86_64"]; f.save();
    assert.throws(() => loadNativeBuild(f.directory, f.expected));
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("APK modificado e artefato por link não podem ser instalados", () => {
  const f = fixture();
  try {
    const apk = join(f.directory, "verified.apk");
    writeFileSync(apk, "arquivo alterado");
    assert.throws(() => loadNativeBuild(f.directory, f.expected), /APK alterado/);
    rmSync(apk); symlinkSync(join(f.directory, "report.json"), apk);
    assert.throws(() => loadNativeBuild(f.directory, f.expected), /arquivo regular/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});
