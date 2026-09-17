import { spawnSync } from "node:child_process";
const probes = [
  ["Node", process.execPath, ["--version"]],
  ["npm", "npm", ["--version"]],
  ["Git", "git", ["--version"]],
  ["Docker", "docker", ["--version"]],
  ["Docker Compose", "docker", ["compose", "version"]],
  ["Android adb", "adb", ["version"]],
];
if (process.platform === "darwin") probes.push(["Xcode", "xcodebuild", ["-version"]]);
let missing = 0;
console.log("JeriFlow — diagnóstico local (não lê senhas, contas ou variáveis secretas)");
console.log("Sistema:", process.platform, process.arch);
for (const [label, command, args] of probes) {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 10000, shell: false });
  const ok = !r.error && r.status === 0;
  if (!ok) missing++;
  console.log(label + ": " + (ok ? r.stdout.trim().split("\n").slice(0,2).join(" ") : "AUSENTE OU INDISPONÍVEL"));
}
console.log("Ferramentas pendentes:", missing);
console.log("Esta verificação não substitui compilar Android/iOS nem iniciar o banco.");
process.exitCode = missing ? 1 : 0;
