import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

// Diretórios exclusivos do runner descartável. Preservar e conferir o APK antes
// de remover o projeto Android gerado e o cache Gradle desta execução.
export function preserveApkAndCleanBuild({ work, projectRoot, appDirectory, apk, sha256 }) {
  assert.equal(resolve(appDirectory), join(resolve(projectRoot), "apps", basename(appDirectory)), "App fora do projeto");
  const nativeDirectory = join(resolve(appDirectory), "android");
  const gradleDirectory = join(resolve(work), "gradle");
  const dependencyDirectory = join(resolve(projectRoot), "node_modules");
  const preserved = join(resolve(work), "verified.apk");
  const destinationRelative = relative(nativeDirectory, resolve(work));
  assert(destinationRelative === ".." || destinationRelative.startsWith("../"), "Destino do APK dentro dos intermediários");
  assert.equal(resolve(apk), join(nativeDirectory, "app/build/outputs/apk/release/app-release.apk"), "APK fora do projeto gerado");
  for (const path of [nativeDirectory, gradleDirectory, dependencyDirectory]) {
    const stat = lstatSync(path);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), "Recusando limpar diretório substituído por link");
  }
  assert(lstatSync(apk).isFile() && !lstatSync(apk).isSymbolicLink(), "APK não é arquivo regular");
  assert.equal(realpathSync(apk), join(realpathSync(nativeDirectory), "app/build/outputs/apk/release/app-release.apk"), "APK atravessa link externo");
  assert(!existsSync(preserved), "Recusando sobrescrever APK preservado");
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.equal(hash(apk), sha256, "APK mudou antes da preservação");
  copyFileSync(apk, preserved);
  assert.equal(hash(preserved), sha256, "Cópia do APK divergiu; não remover intermediários");
  rmSync(nativeDirectory, { recursive: true });
  rmSync(gradleDirectory, { recursive: true });
  // Após gerar e conferir o APK, instalação/abertura usam somente ferramentas
  // Android e módulos nativos do Node. rmSync remove links dos workspaces sem
  // seguir seus destinos; as fontes apps/ e packages/ permanecem intactas.
  rmSync(dependencyDirectory, { recursive: true });
  return preserved;
}
