import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mobileApps } from "../packages/contracts/src/catalog.ts";

export function nativeMatrix(platform = "android", appId = "all") {
  assert(["android", "ios", "all"].includes(platform), "Plataforma desconhecida");
  assert(appId === "all" || mobileApps.some(app => app.id === appId), "App desconhecido");
  assert(platform !== "ios" || appId === "all", "Para iOS, selecionar todos os apps");
  const include = [];
  if (platform !== "ios") {
    for (const app of mobileApps.filter(app => appId === "all" || app.id === appId)) {
      include.push({ platform: "android", app: app.id, runner: "ubuntu-24.04", jobMinutes: 35, stepMinutes: 30 });
    }
  }
  if (platform !== "android") include.push({ platform: "ios", app: "all", runner: "macos-26", jobMinutes: 55, stepMinutes: 48 });
  return { include };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.env.GITHUB_OUTPUT, "Saída do GitHub Actions ausente");
  const matrix = nativeMatrix(process.env.NATIVE_PLATFORM, process.env.NATIVE_APP);
  const android = { include: matrix.include.filter(entry => entry.platform === "android") };
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nandroid_matrix=${JSON.stringify(android)}\nhas_android=${android.include.length > 0}\n`);
}
