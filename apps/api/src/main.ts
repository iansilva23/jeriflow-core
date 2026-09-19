import { createApp } from "./server.ts";
import { createDependencyProbe, readLocalConfiguration } from "./infrastructure.ts";
import { IdentityService } from "./identity.ts";
const raw = process.env.PORT ?? "3001";
const port = Number(raw);
if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("PORT deve ser um inteiro entre 1024 e 65535.");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Este esqueleto não está liberado para produção.");
}
const config = readLocalConfiguration(process.env);
const identity = config ? new IdentityService(config) : undefined;
const server = createApp(createDependencyProbe(config), identity);
server.on("error", () => {
  console.error("API não iniciou. Verifique se a porta local já está em uso.");
  process.exitCode = 1;
  void identity?.close();
});
server.listen(port, "127.0.0.1", () => console.log("API de desenvolvimento: http://127.0.0.1:" + port));
function stop() {
  server.close(() => { void (identity?.close() ?? Promise.resolve()).then(() => process.exit(0), () => process.exit(1)); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
