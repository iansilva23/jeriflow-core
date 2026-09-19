import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { prepareLocalEnvironment } from "./local-environment.mjs";
import { readLocalConfiguration } from "../apps/api/src/infrastructure.ts";

export function localIdentityConfiguration(root) {
  if (process.env.NODE_ENV === "production") throw new Error("LOCAL_ONLY");
  prepareLocalEnvironment(root);
  return readLocalConfiguration(parseEnv(readFileSync(resolve(root, ".env.local"), "utf8")));
}
export function ownerClient(root) {
  localIdentityConfiguration(root); // Verifica a configuração completa antes de ler o segredo.
  const client = new pg.Client({ host: "127.0.0.1", port: 55432, database: "jeriflow_dev", user: "jeriflow_owner",
    password: readFileSync(resolve(root, ".secrets/postgres-owner-password"), "utf8").trim(),
    connectionTimeoutMillis: 2000, statement_timeout: 5000, query_timeout: 6000 });
  client.on("error", () => {});
  return client;
}
export async function migrateIdentity(root) {
  const client = ownerClient(root);
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(742819,1)");
    await client.query(`CREATE TABLE IF NOT EXISTS app.schema_migrations (
      name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    await client.query("REVOKE ALL ON app.schema_migrations FROM PUBLIC, jeriflow_app");
    const directory = resolve(root, "infra/migrations");
    const applied = [];
    for (const name of readdirSync(directory).filter(name => /^\d{3}-[a-z-]+\.sql$/.test(name)).sort()) {
      const sql = readFileSync(resolve(directory, name), "utf8");
      const sha = createHash("sha256").update(sql).digest("hex");
      const before = await client.query("SELECT sha256 FROM app.schema_migrations WHERE name=$1", [name]);
      if (before.rowCount) {
        if (before.rows[0].sha256 !== sha) throw new Error("MIGRATION_CHECKSUM_MISMATCH");
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO app.schema_migrations(name,sha256) VALUES ($1,$2)", [name, sha]);
      applied.push(name);
    }
    await client.query("COMMIT");
    return applied;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { await client.end().catch(() => {}); }
}
