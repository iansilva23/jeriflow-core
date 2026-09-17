import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync, lstatSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

function inspectPath(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

export function prepareLocalEnvironment(root) {
  const folder = resolve(root, ".secrets");
  const environment = resolve(root, ".env.local");
  const names = ["postgres-owner-password", "postgres-app-password", "redis.conf"];
  // Não rotacionar senhas nem sobrescrever uma configuração existente por acidente.
  const folderStat = inspectPath(folder);
  const environmentStat = inspectPath(environment);
  if (folderStat || environmentStat) {
    if (!folderStat?.isDirectory() || !environmentStat?.isFile() || folderStat.isSymbolicLink()
      || environmentStat.isSymbolicLink() || !names.every(n => existsSync(resolve(folder, n)))) {
      throw new Error("Configuração local parcial ou inválida. Preserve os arquivos e solicite revisão; nada foi sobrescrito.");
    }
    if (process.platform !== "win32" && ((folderStat.mode & 0o077) || (environmentStat.mode & 0o077))) {
      throw new Error("Permissões locais excessivas. Preserve os arquivos e solicite revisão.");
    }
    for (const name of names) {
      const file = resolve(folder, name);
      if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error("Segredo local inválido.");
    }
    const owner = readFileSync(resolve(folder, names[0]), "utf8").trim();
    const app = readFileSync(resolve(folder, names[1]), "utf8").trim();
    const redis = readFileSync(resolve(folder, names[2]), "utf8").match(/^requirepass ([a-f0-9]{64})$/m)?.[1];
    const env = parseEnv(readFileSync(environment, "utf8"));
    if (!/^[a-f0-9]{64}$/.test(owner) || !/^[a-f0-9]{64}$/.test(app) || !redis || owner === app
      || env.NODE_ENV !== "development"
      || env.DATABASE_URL !== `postgresql://jeriflow_app:${app}@127.0.0.1:55432/jeriflow_dev`
      || env.REDIS_URL !== `redis://:${redis}@127.0.0.1:56379`) throw new Error("Configuração inconsistente. Nenhuma senha foi alterada.");
    return "preserved";
  }
  const owner = randomBytes(32).toString("hex");
  const app = randomBytes(32).toString("hex");
  const cache = randomBytes(32).toString("hex");
  mkdirSync(folder, { mode: 0o700 });
  // Diretório 0700 protege o acesso no host. Arquivos 0444 permitem a leitura
  // dos secrets montados individualmente pelo usuário não-root dos containers.
  for (const [name, value] of [
    [names[0], owner + "\n"],
    [names[1], app + "\n"],
    [names[2], `bind 0.0.0.0\nprotected-mode yes\nrequirepass ${cache}\nappendonly yes\ndir /data\nmaxmemory 128mb\nmaxmemory-policy noeviction\n`],
  ]) writeFileSync(resolve(folder, name), value, { flag: "wx", mode: 0o444 });
  writeFileSync(environment,
    `# GERADO LOCALMENTE. Não compartilhar, versionar ou usar em produção.\nNODE_ENV=development\nPORT=3001\nDATABASE_URL=postgresql://jeriflow_app:${app}@127.0.0.1:55432/jeriflow_dev\nREDIS_URL=redis://:${cache}@127.0.0.1:56379\n`,
    { flag: "wx", mode: 0o600 });
  return "created";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const state = prepareLocalEnvironment(root);
    console.log(state === "created" ? "Configuração local criada com senhas aleatórias. Nenhum serviço foi iniciado." : "Configuração existente preservada. Senhas não foram alteradas.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
