import { fileURLToPath } from "node:url";
import { migrateIdentity } from "./identity-database.mjs";
try {
  const applied = await migrateIdentity(fileURLToPath(new URL("..", import.meta.url)));
  console.log("Migrações de identidade conferidas; aplicadas: " + applied.length + ". Dados existentes preservados.");
} catch {
  console.error("Migração não aplicada. Confira infraestrutura local e integridade das migrações; nenhuma credencial foi exibida.");
  process.exitCode = 1;
}
