import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareLocalEnvironment } from "./local-environment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commands = {
  up: ["up", "--detach", "--wait", "--wait-timeout", "120"],
  down: ["down"], // Sem --volumes: parar NÃO apaga os dados.
  status: ["ps"],
};
const command = commands[process.argv[2]];
if (!command) throw new Error("Operação inválida. Use up, down ou status.");
try {
  prepareLocalEnvironment(root);
  const child = spawn("docker", ["compose", "-f", resolve(root, "infra/compose.yaml"), ...command],
    { cwd: root, stdio: "inherit", shell: false });
  child.on("error", () => { console.error("Docker/Compose indisponível. Nenhum serviço externo foi contratado."); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
