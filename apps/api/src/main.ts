import { createApp } from "./server.ts";
import { createDependencyProbe, readLocalConfiguration } from "./infrastructure.ts";
import { IdentityService } from "./identity.ts";
import { readIdentityKey } from "./identity-security.ts";
import { GuardTrafficReadServiceV516 } from "./guard-traffic-read-http-v516.ts";
import { GuardMutationServiceV516 } from "./guard-traffic-mutation-http-v516.ts";
import { GuardShiftServiceV516 } from "./guard-shift-service-v516.ts";
import { GuardSupportServiceV516 } from "./guard-support-service-v516.ts";
import { openLocalTrafficPhotoRuntimeV516 } from "./traffic-photo-runtime-v516.ts";
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
if (!config && process.env.JF_TRAFFIC_PHOTO_LOCAL === "1") throw new Error("A API de fotos exige infraestrutura local.");
const trafficPhoto = config && await openLocalTrafficPhotoRuntimeV516(config, process.env);
const identity = config ? new IdentityService(config, { encryptionKey: readIdentityKey(fileURLToPath(new URL("../../..", import.meta.url))) }) : undefined;
const guardRead = config && new GuardTrafficReadServiceV516(config.databaseUrl);
const guardMutation = config && new GuardMutationServiceV516(config.databaseUrl);
const guardShift = config && new GuardShiftServiceV516(config.databaseUrl);
const guardSupport = config && new GuardSupportServiceV516(config.databaseUrl);
async function closeServices() {
  const results = await Promise.allSettled([
    trafficPhoto?.close(), identity?.close(), guardRead?.close(), guardMutation?.close(), guardShift?.close(), guardSupport?.close(),
  ]);
  if (results.some(result => result.status === "rejected")) throw new Error("Falha ao encerrar serviços locais.");
}
let delivering = false;
const mailTimer = identity ? setInterval(() => {
  if (delivering) return;
  delivering = true;
  void identity.deliverMailBatch().then(result => {
    if (result.failed) console.error("Entrega local de email pendente; nova tentativa limitada será realizada.");
  }).catch(() => console.error("Fila de email local indisponível.")).finally(() => { delivering = false; });
}, 5000) : undefined;
mailTimer?.unref();
const server = createApp(createDependencyProbe(config), identity, trafficPhoto?.http, guardRead, guardMutation, guardShift, guardSupport, trafficPhoto?.form);
server.on("error", () => {
  console.error("API não iniciou. Verifique se a porta local já está em uso.");
  process.exitCode = 1;
  clearInterval(mailTimer);
  void closeServices().catch(() => console.error("Falha ao encerrar serviços locais."));
});
server.listen(port, "127.0.0.1", () => console.log("API de desenvolvimento: http://127.0.0.1:" + port));
function stop() {
  clearInterval(mailTimer);
  server.close(() => { void closeServices().then(() => process.exit(0), () => process.exit(1)); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
