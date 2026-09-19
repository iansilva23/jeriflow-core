import { createApp } from "./server.ts";
import { createDependencyProbe, readLocalConfiguration } from "./infrastructure.ts";
import { IdentityService } from "./identity.ts";
import { readIdentityKey } from "./identity-security.ts";
import { fileURLToPath } from "node:url";
const raw = process.env.PORT ?? "3001";
const port = Number(raw);
if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("PORT deve ser um inteiro entre 1024 e 65535.");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Este esqueleto não está liberado para produção.");
}
const config = readLocalConfiguration(process.env);
const identity = config ? new IdentityService(config, { encryptionKey: readIdentityKey(fileURLToPath(new URL("../../..", import.meta.url))) }) : undefined;
let delivering = false;
const mailTimer = identity ? setInterval(() => {
  if (delivering) return;
  delivering = true;
  void identity.deliverMailBatch().then(result => {
    if (result.failed) console.error("Entrega local de email pendente; nova tentativa limitada será realizada.");
  }).catch(() => console.error("Fila de email local indisponível.")).finally(() => { delivering = false; });
}, 5000) : undefined;
mailTimer?.unref();
const server = createApp(createDependencyProbe(config), identity);
server.on("error", () => {
  console.error("API não iniciou. Verifique se a porta local já está em uso.");
  process.exitCode = 1;
  clearInterval(mailTimer);
  void identity?.close();
});
server.listen(port, "127.0.0.1", () => console.log("API de desenvolvimento: http://127.0.0.1:" + port));
function stop() {
  clearInterval(mailTimer);
  server.close(() => { void (identity?.close() ?? Promise.resolve()).then(() => process.exit(0), () => process.exit(1)); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
