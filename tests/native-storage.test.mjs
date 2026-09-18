import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { preserveApkAndCleanBuild } from "../scripts/native-storage.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "jeriflow-storage-test-"));
  const work = join(root, "run"), appDirectory = join(root, "app");
  const apk = join(appDirectory, "android/app/build/outputs/apk/release/app-release.apk");
  mkdirSync(dirname(apk), { recursive: true });
  mkdirSync(join(work, "gradle"), { recursive: true });
  const contents = Buffer.from([0, 255, 80, 75, 3, 4]);
  writeFileSync(apk, contents);
  writeFileSync(join(work, "gradle/cache-test"), "temporário");
  writeFileSync(join(appDirectory, "App.tsx"), "fonte preservada");
  return { root, work, appDirectory, apk, sha256: createHash("sha256").update(contents).digest("hex") };
}

test("liberação de disco preserva APK e fonte, removendo somente intermediários", () => {
  const f = fixture();
  try {
    const original = readFileSync(f.apk);
    const preserved = preserveApkAndCleanBuild(f);
    assert.deepEqual(readFileSync(preserved), original);
    assert.equal(readFileSync(join(f.appDirectory, "App.tsx"), "utf8"), "fonte preservada");
    assert.equal(existsSync(join(f.appDirectory, "android")), false);
    assert.equal(existsSync(join(f.work, "gradle")), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("limpeza recusa checksum divergente, caminhos externos, sobrescrita e links", () => {
  const f = fixture();
  try {
    assert.throws(() => preserveApkAndCleanBuild({ ...f, sha256: "0".repeat(64) }), /APK mudou/);
    assert.throws(() => preserveApkAndCleanBuild({ ...f, apk: join(f.root, "outro.apk") }), /fora do projeto/);
    assert.throws(() => preserveApkAndCleanBuild({ ...f, work: join(f.appDirectory, "android/temp") }), /dentro dos intermediários/);
    writeFileSync(join(f.work, "verified.apk"), "não sobrescrever");
    assert.throws(() => preserveApkAndCleanBuild(f), /sobrescrever/);
    assert.equal(readFileSync(join(f.work, "verified.apk"), "utf8"), "não sobrescrever");
    rmSync(join(f.work, "verified.apk"));
    rmSync(join(f.work, "gradle"), { recursive: true });
    const outside = join(f.root, "preservar");
    mkdirSync(outside); writeFileSync(join(outside, "marker"), "preservado");
    symlinkSync(outside, join(f.work, "gradle"));
    assert.throws(() => preserveApkAndCleanBuild(f), /link/);
    assert.equal(readFileSync(join(outside, "marker"), "utf8"), "preservado");
    assert(existsSync(f.apk));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
