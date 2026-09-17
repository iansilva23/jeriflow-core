import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mobileApps } from "../packages/contracts/src/catalog.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const app of mobileApps) {
  console.log("Gerando Android/iOS:", app.name);
  const code = await new Promise(resolveCode => {
    const child = spawn(process.execPath, [resolve(root, "node_modules/expo/bin/cli"), "export", "--platform", "all", "--max-workers", "2"], {
      cwd: resolve(root, "apps", app.id), stdio: "inherit", shell: false,
      env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1" },
      timeout: 600_000,
    });
    child.on("error", () => resolveCode(1));
    child.on("exit", code => resolveCode(code ?? 1));
  });
  if (code !== 0) { process.exitCode = 1; break; }
  const output = resolve(root, "apps", app.id, "dist");
  const metadata = JSON.parse(readFileSync(resolve(output, "metadata.json"), "utf8"));
  for (const platform of ["android", "ios"]) {
    const bundle = metadata.fileMetadata?.[platform]?.bundle;
    if (!bundle || !existsSync(resolve(output, bundle))) throw new Error(`Bundle ausente: ${app.id}/${platform}`);
  }
}
if (!process.exitCode) console.log("Oito bundles móveis aprovados. Isso NÃO comprova APK/IPA ou execução em aparelho.");
