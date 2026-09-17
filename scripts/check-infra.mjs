import { inspectDatabase, inspectCache, readLocalConfiguration } from "../apps/api/src/infrastructure.ts";
try {
  const config = readLocalConfiguration(process.env);
  if (!config) throw new Error("CONFIGURATION_MISSING");
  const results = await Promise.allSettled([inspectDatabase(config, true), inspectCache(config, true)]);
  const labels = ["PostgreSQL: conexão, papel sem privilégios administrativos, escrita/leitura temporária e rollback", "Redis: conexão, escrita/leitura temporária e remoção da chave de teste"];
  results.forEach((r, i) => console.log(labels[i] + ": " + (r.status === "fulfilled" ? "APROVADO" : "FALHOU")));
  process.exitCode = results.some(r => r.status === "rejected") ? 1 : 0;
  if (process.exitCode) console.error("Serviços locais ausentes ou configuração incorreta. Não enviar senhas no chat.");
} catch {
  console.error("Diagnóstico indisponível: execute a preparação local e inicie a infraestrutura. Nenhuma aprovação foi registrada.");
  process.exitCode = 1;
}
