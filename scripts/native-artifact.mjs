import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadNativeBuild(directory, expected) {
  const apk = join(directory, "verified.apk");
  const reportPath = join(directory, "report.json");
  for (const path of [apk, reportPath]) {
    const stat = lstatSync(path);
    assert(stat.isFile() && !stat.isSymbolicLink(), "Artefato precisa ser arquivo regular");
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.stage, "build");
  assert.equal(report.platform, "android");
  assert.equal(report.status, "compiled", "Build não foi concluído");
  assert.equal(report.commit, expected.commit, "Artefato de outro commit");
  assert.equal(report.runId, expected.runId, "Artefato de outra execução");
  assert.equal(report.lockfileSha256, expected.lockfileSha256, "Lockfile diferente");
  assert.equal(report.template.integrity, expected.templateIntegrity, "Template diferente");
  assert.deepEqual(report.selectedAppIds, [expected.appId]);
  assert.equal(report.apps.length, 1);
  const app = report.apps[0];
  assert.equal(app.id, expected.appId, "App diferente");
  assert.equal(app.packageIdentifier, expected.packageIdentifier, "Identidade diferente");
  assert.equal(app.status, "compiled");
  assert.equal(app.build.configuration, "Release");
  assert.deepEqual(app.build.architectures, ["arm64-v8a", "x86_64"]);
  assert.equal(app.build.manifestChecked, true);
  assert.equal(app.build.embeddedJavaScript, true);
  assert.match(app.build.sha256, /^[a-f0-9]{64}$/);
  assert.equal(createHash("sha256").update(readFileSync(apk)).digest("hex"), app.build.sha256, "APK alterado após a compilação");
  return { apk, build: app.build, source: { commit: report.commit, runId: report.runId, attempt: report.attempt, lockfileSha256: report.lockfileSha256 } };
}
