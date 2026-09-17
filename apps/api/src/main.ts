import { createApp } from "./server.ts";
import { createDependencyProbe, readLocalConfiguration } from "./infrastructure.ts";
const raw = process.env.PORT ?? "3001";
const port = Number(raw);
if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("PORT deve ser um inteiro entre 1024 e 65535.");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Este esqueleto não está liberado para produção.");
}
const server = createApp(createDependencyProbe(readLocalConfiguration(process.env)));
server.on("error", () => {
  console.error("API não iniciou. Verifique se a porta local já está em uso.");
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log("API de desenvolvimento: http://127.0.0.1:" + port));
function stop() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
