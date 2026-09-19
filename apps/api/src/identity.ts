import pg from "pg";
import { createClient } from "redis";
import { randomBytes } from "node:crypto";
import type { LocalConfiguration } from "./infrastructure.ts";
import { IdentityError, exactObject, emailAddress, passwordValue, verifyPassword, sessionHash, digest, uuid } from "./identity-primitives.ts";
import { permissionsFor, permissionCatalog, platformPermissions } from "../../../packages/contracts/src/access.ts";

type PublicUser = { id: string; email: string; displayName: string };
type MunicipalityAccess = { id: string; displayName: string; roles: string[]; permissions: string[] };
type Context = { user: PublicUser; municipalities: MunicipalityAccess[]; platformPermissions: string[] };
const invalidLogin = () => new IdentityError(401, "INVALID_CREDENTIALS");

export class IdentityService {
  private pool: pg.Pool;
  private cache: ReturnType<typeof createClient>;
  private connecting?: Promise<void>;
  private closed = false;
  private throttleNamespace: string;
  constructor(config: LocalConfiguration, options: { throttleNamespace?: string } = {}) {
    this.throttleNamespace = options.throttleNamespace ?? "jeriflow:login";
    if (!/^jeriflow:(login|test:[a-f0-9-]{36}:login)$/.test(this.throttleNamespace)) throw new Error("INVALID_THROTTLE_NAMESPACE");
    this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8, connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10_000, statement_timeout: 3000, query_timeout: 4000, application_name: "jeriflow-identity" });
    this.pool.on("error", () => {});
    this.cache = createClient({ url: config.redisUrl, socket: { connectTimeout: 2000, reconnectStrategy: false }, disableOfflineQueue: true });
    this.cache.on("error", () => {});
  }
  async close() {
    this.closed = true;
    if (this.cache.isOpen) this.cache.destroy();
    await this.pool.end();
  }
  private async transaction<T>(operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let reusable = true;
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { reusable = false; }
      throw error;
    } finally { client.release(!reusable); }
  }
  private async audit(client: Pick<pg.PoolClient, "query">, event: string, requestId: string, actor?: string, municipality?: string) {
    await client.query("INSERT INTO app.identity_audit(request_id, actor_id, municipality_id, event_code) VALUES ($1,$2,$3,$4)",
      [uuid(requestId), actor ?? null, municipality ?? null, event]);
  }
  private async throttle(email: string, remoteAddress: string) {
    if (this.closed) throw new IdentityError(503, "IDENTITY_UNAVAILABLE");
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        (async () => {
          if (!this.cache.isReady) {
            this.connecting ??= this.cache.connect().then(() => {}).finally(() => { this.connecting = undefined; });
            await this.connecting;
          }
          // Operação atômica compartilhada por todas as instâncias; sem email/IP em texto.
          const remaining = Number(await this.cache.eval(`
            local wait = 0
            for i, key in ipairs(KEYS) do
              local n = redis.call('INCR', key)
              if n == 1 then redis.call('EXPIRE', key, 900) end
              if n > tonumber(ARGV[i]) then wait = math.max(wait, redis.call('TTL', key)) end
            end
            return wait`, { keys: [this.throttleNamespace + ":account:" + digest(email), this.throttleNamespace + ":ip:" + digest(remoteAddress)], arguments: ["10", "60"] }));
          if (remaining > 0) throw new IdentityError(429, "TOO_MANY_ATTEMPTS", remaining);
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          if (this.cache.isOpen) this.cache.destroy();
          reject(new IdentityError(503, "IDENTITY_UNAVAILABLE"));
        }, 2500); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async login(input: unknown, remoteAddress: string, requestId: string) {
    const body = exactObject(input, ["email", "password"]);
    const email = emailAddress(body.email), password = passwordValue(body.password);
    await this.throttle(email, remoteAddress);
    const result = await this.pool.query("SELECT id, password_hash, active FROM app.identity_users WHERE email=$1", [email]);
    const user = result.rows[0];
    const matches = await verifyPassword(password, user?.password_hash);
    if (!matches || !user?.active) {
      await this.audit(this.pool, "auth.login_failed", requestId);
      throw invalidLogin();
    }
    return await this.transaction(async client => {
      // Serializa a emissão por usuário, inclusive em múltiplas instâncias.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["jeriflow-session:" + user.id]);
      const token = randomBytes(32).toString("base64url");
      // Revalida credenciais após o hash lento: conta desativada/alterada não emite sessão.
      const inserted = await client.query(`INSERT INTO app.identity_sessions(token_hash,user_id,auth_version)
        SELECT $1,id,auth_version FROM app.identity_users WHERE id=$2 AND active AND password_hash=$3 RETURNING expires_at`,
      [sessionHash(token), user.id, user.password_hash]);
      if (inserted.rowCount !== 1) throw invalidLogin();
      await client.query(`DELETE FROM app.identity_sessions WHERE token_hash IN (
        SELECT token_hash FROM app.identity_sessions WHERE expires_at <= clock_timestamp() LIMIT 100)`);
      await client.query(`DELETE FROM app.identity_sessions WHERE token_hash IN (
        SELECT token_hash FROM app.identity_sessions WHERE user_id=$1 ORDER BY created_at DESC, token_hash OFFSET 10)`, [user.id]);
      await this.audit(client, "auth.login_success", requestId, user.id);
      return { accessToken: token, tokenType: "Bearer", expiresAt: inserted.rows[0].expires_at.toISOString(), idleTimeoutSeconds: 900 };
    });
  }
  private async authenticated<T>(token: unknown, operation: (client: pg.PoolClient, user: PublicUser, master: boolean, hash: string) => Promise<T>) {
    const hash = sessionHash(token);
    return this.transaction(async client => {
      const result = await client.query(`UPDATE app.identity_sessions s SET last_seen_at=clock_timestamp()
        FROM app.identity_users u WHERE s.token_hash=$1 AND u.id=s.user_id AND u.active AND u.auth_version=s.auth_version
        AND s.expires_at > clock_timestamp() AND s.last_seen_at > clock_timestamp() - interval '15 minutes'
        RETURNING u.id, u.email, u.display_name, u.platform_admin`, [hash]);
      if (result.rowCount !== 1) throw new IdentityError(401, "UNAUTHORIZED");
      const r = result.rows[0];
      await client.query("SELECT set_config('app.actor_id', $1, true)", [r.id]);
      return operation(client, { id: r.id, email: r.email, displayName: r.display_name }, r.platform_admin, hash);
    });
  }
  private async context(client: pg.PoolClient, user: PublicUser, master: boolean): Promise<Context> {
    const result = await client.query(`SELECT t.id, t.display_name, array_agg(m.role_code ORDER BY m.role_code) AS roles
      FROM app.municipalities t JOIN app.memberships m ON m.municipality_id=t.id
      GROUP BY t.id, t.display_name ORDER BY t.id`);
    return { user, municipalities: result.rows.map(r => ({ id: r.id, displayName: r.display_name, roles: r.roles, permissions: permissionsFor(r.roles) })),
      platformPermissions: master ? [...platformPermissions] : [] };
  }
  async me(token: unknown): Promise<Context> {
    return this.authenticated(token, (client, user, master) => this.context(client, user, master));
  }
  async access(token: unknown, municipality: string | undefined, permission: string, requestId: string) {
    if (!permissionCatalog.includes(permission)) throw new IdentityError(400, "INVALID_PERMISSION");
    const municipalityId = municipality === undefined ? undefined : uuid(municipality);
    const allowed = await this.authenticated(token, async (client, user, master) => {
      const ctx = await this.context(client, user, master);
      const granted = municipalityId === undefined ? ctx.platformPermissions.includes(permission)
        : ctx.municipalities.some(t => t.id === municipalityId && t.permissions.includes(permission));
      if (!granted) await this.audit(client, "auth.access_denied", requestId, user.id, municipalityId);
      return granted;
    }); // A recusa é auditada e confirmada antes de devolver 403.
    if (!allowed) throw new IdentityError(403, "FORBIDDEN");
    return { allowed: true, municipalityId: municipalityId ?? null, permission };
  }
  async logout(token: unknown, all: boolean, requestId: string) {
    await this.authenticated(token, async (client, user, _master, hash) => {
      await client.query(all ? "DELETE FROM app.identity_sessions WHERE user_id=$1" : "DELETE FROM app.identity_sessions WHERE token_hash=$1",
        [all ? user.id : hash]);
      await this.audit(client, all ? "auth.logout_all" : "auth.logout", requestId, user.id);
    });
  }
}
