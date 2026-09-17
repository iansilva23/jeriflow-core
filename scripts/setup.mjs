import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 15) {
  console.error("Este projeto requer Node 24.15 ou superior dentro da série 24. Nenhuma instalação foi iniciada.");
  process.exitCode = 1;
} else {
  console.log("Instalando o lockfile com npm 12.0.2, sem modificar o npm global e sem executar scripts de terceiros.");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const child = spawn("npm", ["exec", "--yes", "--ignore-scripts", "--package=npm@12.0.2", "--", "npm", "ci", "--ignore-scripts"],
    { cwd: root, stdio: "inherit", shell: false, timeout: 600_000 });
  child.on("error", () => { console.error("Não foi possível executar o gerenciador. Verifique Node/npm e a autorização de rede."); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
