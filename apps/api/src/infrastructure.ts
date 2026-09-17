import pg from "pg";
import { createClient } from "redis";
import { randomUUID } from "node:crypto";

export type DependencyReport = {
  database: "ready" | "unavailable" | "not_configured";
  cache: "ready" | "unavailable" | "not_configured";
};
export type LocalConfiguration = { databaseUrl: string; redisUrl: string };

export function readLocalConfiguration(env: NodeJS.ProcessEnv): LocalConfiguration | undefined {
  if (!env.DATABASE_URL && !env.REDIS_URL) return undefined;
  if (env.NODE_ENV === "production") throw new Error("Infraestrutura local não autorizada em produção.");
  for (const [key, protocol, port] of [["DATABASE_URL", "postgresql:", "55432"], ["REDIS_URL", "redis:", "56379"]]) {
    try {
      const url = new URL(env[key] ?? "");
      if (url.hostname !== "127.0.0.1" || url.protocol !== protocol || url.port !== port
        || !url.password || url.search || url.hash) throw new Error();
      if (key === "DATABASE_URL" && (url.pathname !== "/jeriflow_dev" || url.username !== "jeriflow_app")) throw new Error();
      if (key === "REDIS_URL" && (url.username || (url.pathname && url.pathname !== "/"))) throw new Error();
    } catch {
      // Nunca incluir a URL (que contém senha) na mensagem de erro.
      throw new Error(`${key}: configuração inválida; somente o ambiente local JeriFlow é aceito nesta etapa.`);
    }
  }
  return { databaseUrl: env.DATABASE_URL!, redisUrl: env.REDIS_URL! };
}

export async function inspectDatabase(config: LocalConfiguration, exercise = false): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 2000,
    query_timeout: 2000, statement_timeout: 2000, application_name: "jeriflow-local-diagnostic" });
  // Conexão perdida não pode derrubar o processo por evento de erro não tratado.
  client.on("error", () => {});
  try {
    await client.connect();
    const result = await client.query("SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    if (result.rowCount !== 1 || Object.values(result.rows[0]).some(Boolean)) throw new Error("DATABASE_ROLE_TOO_POWERFUL");
    if (exercise) {
      await client.query("BEGIN");
      await client.query("CREATE TEMP TABLE jeriflow_diagnostic (id uuid PRIMARY KEY, marker text NOT NULL) ON COMMIT DROP");
      const id = randomUUID();
      await client.query("INSERT INTO jeriflow_diagnostic (id, marker) VALUES ($1, $2)", [id, "fictitious"]);
      const read = await client.query("SELECT marker FROM jeriflow_diagnostic WHERE id = $1", [id]);
      if (read.rows[0]?.marker !== "fictitious") throw new Error("DATABASE_READBACK_FAILED");
      await client.query("ROLLBACK");
      const after = await client.query("SELECT to_regclass('pg_temp.jeriflow_diagnostic') AS name");
      if (after.rows[0]?.name !== null) throw new Error("DATABASE_ROLLBACK_FAILED");
    }
  } finally {
    await client.end().catch(() => {});
  }
}

export async function inspectCache(config: LocalConfiguration, exercise = false): Promise<void> {
  const client = createClient({ url: config.redisUrl, socket: { connectTimeout: 2000, reconnectStrategy: false }, disableOfflineQueue: true });
  client.on("error", () => {});
  // Um servidor que aceita TCP mas não responde também precisa ter prazo limite.
  const deadline = setTimeout(() => { if (client.isOpen) client.destroy(); }, 3000);
  try {
    await client.connect();
    if (await client.ping() !== "PONG") throw new Error("CACHE_PING_FAILED");
    if (exercise) {
      const key = "jeriflow:diagnostic:" + randomUUID();
      try {
        await client.set(key, "fictitious", { expiration: { type: "EX", value: 10 } });
        if (await client.get(key) !== "fictitious") throw new Error("CACHE_READBACK_FAILED");
      } finally { if (client.isReady) await client.del(key); }
    }
  } finally {
    clearTimeout(deadline);
    if (client.isOpen) client.destroy();
  }
}

export function createDependencyProbe(config: LocalConfiguration | undefined) {
  let inflight: Promise<DependencyReport> | undefined;
  let last: DependencyReport | undefined;
  let until = 0;
  return async (): Promise<DependencyReport> => {
    if (!config) return { database: "not_configured", cache: "not_configured" };
    if (inflight) return inflight;
    if (last && Date.now() < until) return last;
    inflight = Promise.allSettled([inspectDatabase(config), inspectCache(config)]).then(([database, cache]) => {
      last = { database: database.status === "fulfilled" ? "ready" : "unavailable", cache: cache.status === "fulfilled" ? "ready" : "unavailable" };
      until = Date.now() + 1000;
      return last;
    }).finally(() => { inflight = undefined; });
    return inflight;
  };
}
