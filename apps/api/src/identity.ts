import pg from "pg";
import { ouvidoriaMutation, ouvidoriaQuery } from "./ouvidoria-input.ts";
import { attachmentInput, attachmentListInput, encryptAttachment, decryptAttachment } from "./ouvidoria-attachments.ts";
import { createClient } from "redis";
import { randomBytes, randomInt, createHash } from "node:crypto";
import type { LocalConfiguration } from "./infrastructure.ts";
import { IdentityError, exactObject, emailAddress, displayName, passwordValue, verifyPassword, hashPassword, sessionHash, digest, uuid } from "./identity-primitives.ts";
import { managementMutation, managementQuery, publicProfile } from "./account-input.ts";
import { actionHash, base32, matchTotp, seal, unseal } from "./identity-security.ts";
import { sendLocalIdentityMail } from "./identity-mail.ts";
import { permissionsFor, permissionCatalog, platformPermissions } from "../../../packages/contracts/src/access.ts";

type PublicUser = { id: string; email: string; displayName: string };
type MunicipalityAccess = { id: string; displayName: string; roles: string[]; permissions: string[] };
type Context = { user: PublicUser; municipalities: MunicipalityAccess[]; platformPermissions: string[] };
type User = { id: string; email: string; display_name: string; platform_admin: boolean; active: boolean;
  password_hash: string; auth_version: number; email_verified_at: Date | null; mfa_secret: string | null;
  mfa_version: number; mfa_last_step: string; registration_pending: boolean };
type Session = { token_hash: string; created_at: Date; mfa_version: number | null; mfa_verified_at: Date | null };
type MailPurpose = "verify-email" | "reset-password" | "password-changed" | "mfa-changed" | "recovery-used" | "complete-registration" | "access-changed";
const invalidLogin = () => new IdentityError(401, "INVALID_CREDENTIALS");

export class IdentityService {
  private pool: pg.Pool;
  private cache: ReturnType<typeof createClient>;
  private connecting?: Promise<void>;
  private closed = false;
  private throttleNamespace: string;
  private encryptionKey?: Buffer;
  constructor(config: LocalConfiguration, options: { throttleNamespace?: string; encryptionKey?: Buffer } = {}) {
    this.encryptionKey = options.encryptionKey;
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
  private async throttle(email: string, remoteAddress: string, scope = "", accountLimit = 10, ipLimit = 60) {
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
            return wait`, { keys: [this.throttleNamespace + scope + ":account:" + digest(email), this.throttleNamespace + scope + ":ip:" + digest(remoteAddress)], arguments: [String(accountLimit), String(ipLimit)] }));
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
    const result = await this.pool.query("SELECT id, password_hash, active, registration_pending FROM app.identity_users WHERE email=$1", [email]);
    const user = result.rows[0];
    const matches = await verifyPassword(password, user?.password_hash);
    if (!matches || !user?.active || user.registration_pending) {
      await this.audit(this.pool, "auth.login_failed", requestId);
      throw invalidLogin();
    }
    return await this.transaction(async client => {
      // Todas as mutações travam primeiro o usuário, depois sessões/tokens.
      const current = await this.lockUser(client, user.id);
      if (!current?.active || current.registration_pending || current.password_hash !== user.password_hash) throw invalidLogin();
      await client.query("SELECT set_config('app.actor_id', $1, true)", [current.id]);
      const session = await this.issueSession(client, current, false);
      await client.query(`DELETE FROM app.identity_sessions WHERE token_hash IN (
        SELECT token_hash FROM app.identity_sessions WHERE expires_at <= clock_timestamp() LIMIT 100)`);
      await client.query(`DELETE FROM app.identity_sessions WHERE token_hash IN (
        SELECT token_hash FROM app.identity_sessions WHERE user_id=$1 ORDER BY created_at DESC, token_hash OFFSET 10)`, [user.id]);
      await this.audit(client, "auth.login_success", requestId, user.id);
      return session;
    });
  }
  private async lockUser(client: pg.PoolClient, id: string): Promise<User | undefined> {
    return (await client.query("SELECT * FROM app.identity_users WHERE id=$1 FOR UPDATE", [id])).rows[0];
  }
  private async key(client: pg.PoolClient): Promise<Buffer> {
    if (!this.encryptionKey || this.encryptionKey.length !== 32) throw new IdentityError(503, "IDENTITY_SECURITY_UNAVAILABLE");
    const r = await client.query("SELECT fingerprint FROM app.identity_keys WHERE singleton");
    if (r.rows[0]?.fingerprint !== digest(this.encryptionKey.toString("hex"))) throw new IdentityError(503, "IDENTITY_SECURITY_UNAVAILABLE");
    return this.encryptionKey;
  }
  private async security(client: pg.PoolClient, user: User, session?: Session) {
    const ctx = await this.context(client, { id: user.id, email: user.email, displayName: user.display_name }, user.platform_admin);
    const required = user.platform_admin || ctx.municipalities.some(m => m.roles.some(role => role.startsWith("admin-")));
    const verified = !!session?.mfa_verified_at && session.mfa_version === user.mfa_version;
    const nextStep = !user.email_verified_at ? "email_verification" : required && !user.mfa_secret ? "mfa_enrollment"
      : user.mfa_secret && !verified ? "mfa_challenge" : "ready";
    return { ctx, state: { emailVerified: !!user.email_verified_at, mfaEnabled: !!user.mfa_secret, mfaRequired: required, nextStep } };
  }
  private async issueSession(client: pg.PoolClient, user: User, mfa: boolean) {
    const { state } = await this.security(client, user, mfa ? { mfa_verified_at: new Date(), mfa_version: user.mfa_version } as Session : undefined);
    const token = randomBytes(32).toString("base64url");
    const result = await client.query(`INSERT INTO app.identity_sessions(token_hash,user_id,auth_version,mfa_version,mfa_verified_at,expires_at)
      VALUES ($1,$2,$3,$4,CASE WHEN $5 THEN clock_timestamp() ELSE NULL END,clock_timestamp()+$6::interval) RETURNING expires_at`,
    [sessionHash(token), user.id, user.auth_version, mfa ? user.mfa_version : null, mfa, state.nextStep === "ready" ? "8 hours" : "10 minutes"]);
    return { accessToken: token, tokenType: "Bearer", expiresAt: result.rows[0].expires_at.toISOString(), idleTimeoutSeconds: 900, nextStep: state.nextStep };
  }
  private async authenticated<T>(token: unknown, operation: (client: pg.PoolClient, user: User, session: Session) => Promise<T>) {
    const hash = sessionHash(token);
    return this.transaction(async client => {
      const found = await client.query("SELECT user_id FROM app.identity_sessions WHERE token_hash=$1", [hash]);
      const user = found.rowCount ? await this.lockUser(client, found.rows[0].user_id) : undefined;
      if (!user?.active || user.registration_pending) throw new IdentityError(401, "UNAUTHORIZED");
      const result = await client.query(`UPDATE app.identity_sessions s SET last_seen_at=clock_timestamp()
        WHERE s.token_hash=$1 AND s.user_id=$2 AND s.auth_version=$3
        AND s.expires_at > clock_timestamp() AND s.last_seen_at > clock_timestamp() - interval '15 minutes'
        RETURNING s.*`, [hash, user.id, user.auth_version]);
      if (result.rowCount !== 1) throw new IdentityError(401, "UNAUTHORIZED");
      await client.query("SELECT set_config('app.actor_id', $1, true)", [user.id]);
      return operation(client, user, result.rows[0]);
    });
  }
  private async context(client: pg.PoolClient, user: PublicUser, master: boolean): Promise<Context> {
    const result = await client.query(`SELECT t.id, t.display_name, array_agg(m.role_code ORDER BY m.role_code) AS roles
      FROM app.municipalities t JOIN app.memberships m ON m.municipality_id=t.id
      GROUP BY t.id, t.display_name ORDER BY t.id`);
    return { user, municipalities: result.rows.map(r => ({ id: r.id, displayName: r.display_name, roles: r.roles, permissions: permissionsFor(r.roles) })),
      platformPermissions: master ? [...platformPermissions] : [] };
  }
  async me(token: unknown) {
    return this.authenticated(token, async (client, user, session) => {
      const { ctx, state } = await this.security(client, user, session);
      return { ...ctx, municipalities: state.nextStep === "ready" ? ctx.municipalities : [],
        platformPermissions: state.nextStep === "ready" ? ctx.platformPermissions : [], security: state };
    });
  }
  async access(token: unknown, municipality: string | undefined, permission: string, requestId: string) {
    if (!permissionCatalog.includes(permission)) throw new IdentityError(400, "INVALID_PERMISSION");
    const municipalityId = municipality === undefined ? undefined : uuid(municipality);
    const allowed = await this.authenticated(token, async (client, user, session) => {
      const { ctx, state } = await this.security(client, user, session);
      if (state.nextStep !== "ready") {
        await this.audit(client, "auth.access_denied", requestId, user.id, municipalityId);
        return state.nextStep === "email_verification" ? "EMAIL_VERIFICATION_REQUIRED" : "MFA_REQUIRED";
      }
      const granted = municipalityId === undefined ? ctx.platformPermissions.includes(permission)
        : ctx.municipalities.some(t => t.id === municipalityId && t.permissions.includes(permission));
      if (!granted) await this.audit(client, "auth.access_denied", requestId, user.id, municipalityId);
      return granted;
    }); // A recusa é auditada e confirmada antes de devolver 403.
    if (typeof allowed === "string") throw new IdentityError(403, allowed);
    if (!allowed) throw new IdentityError(403, "FORBIDDEN");
    return { allowed: true, municipalityId: municipalityId ?? null, permission };
  }
  async logout(token: unknown, all: boolean, requestId: string) {
    await this.authenticated(token, async (client, user, session) => {
      await client.query(all ? "DELETE FROM app.identity_sessions WHERE user_id=$1" : "DELETE FROM app.identity_sessions WHERE token_hash=$1",
        [all ? user.id : session.token_hash]);
      await this.audit(client, all ? "auth.logout_all" : "auth.logout", requestId, user.id);
    });
  }

  private async queueMail(client: pg.PoolClient, user: User, purpose: MailPurpose, token?: string) {
    const key = await this.key(client);
    const payload = seal(key, `mail:${user.id}:${purpose}`, JSON.stringify({ email: user.email, purpose, token }));
    await client.query(`INSERT INTO app.identity_mail(user_id,purpose,payload,expires_at) VALUES ($1,$2,$3,clock_timestamp()+interval '30 minutes')
      ON CONFLICT (user_id,purpose) DO UPDATE SET payload=$3,attempts=0,available_at=clock_timestamp(),expires_at=clock_timestamp()+interval '30 minutes'`,
    [user.id, purpose, payload]);
  }
  async requestEmail(input: unknown, purpose: "verify-email" | "reset-password", ip: string, requestId: string) {
    const body = exactObject(input, ["email"]), email = emailAddress(body.email);
    const accepted = { accepted: true };
    const started = Date.now();
    try {
      try { await this.throttle(email, ip, ":email", 5, 60); }
      catch (error) { if (error instanceof IdentityError && error.status === 429) return accepted; throw error; }
      await this.transaction(async client => {
        await this.key(client); // Mesma indisponibilidade para contas existentes e inexistentes.
        const r = await client.query("SELECT id FROM app.identity_users WHERE email=$1", [email]);
        const user = r.rowCount ? await this.lockUser(client, r.rows[0].id) : undefined;
        if (!user?.active || user.registration_pending || user.email !== email || (purpose === "verify-email" ? !!user.email_verified_at : !user.email_verified_at)) return;
        const token = randomBytes(32).toString("base64url");
        await client.query(`INSERT INTO app.identity_actions(token_hash,user_id,purpose,auth_version,expires_at)
          VALUES($1,$2,$3,$4,clock_timestamp()+interval '30 minutes') ON CONFLICT(user_id,purpose)
          DO UPDATE SET token_hash=$1,auth_version=$4,expires_at=clock_timestamp()+interval '30 minutes'`, [digest(token), user.id, purpose, user.auth_version]);
        await this.queueMail(client, user, purpose, token);
        await this.audit(client, purpose === "verify-email" ? "auth.email_requested" : "auth.reset_requested", requestId, user.id);
      });
      return accepted;
    } finally {
      // Envio assíncrono e piso de resposta reduzem diferenças temporais entre contas.
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 250 + randomInt(51) - (Date.now() - started))));
    }
  }
  async consumeEmail(input: unknown, purpose: "verify-email" | "reset-password", ip: string, requestId: string) {
    const body = exactObject(input, purpose === "verify-email" ? ["token"] : ["token", "password"]);
    const hash = actionHash(body.token);
    const password = purpose === "reset-password" ? passwordValue(body.password) : undefined;
    await this.throttle(hash, ip, ":action", 5, 60);
    await this.transaction(async client => {
      const found = await client.query("SELECT user_id FROM app.identity_actions WHERE token_hash=$1 AND purpose=$2", [hash, purpose]);
      const user = found.rowCount ? await this.lockUser(client, found.rows[0].user_id) : undefined;
      if (!user?.active) throw new IdentityError(400, "INVALID_OR_EXPIRED_TOKEN");
      const consumed = await client.query(`DELETE FROM app.identity_actions WHERE token_hash=$1 AND purpose=$2 AND user_id=$3
        AND auth_version=$4 AND expires_at>clock_timestamp() RETURNING token_hash`, [hash, purpose, user.id, user.auth_version]);
      if (!consumed.rowCount) throw new IdentityError(400, "INVALID_OR_EXPIRED_TOKEN");
      if (purpose === "verify-email") {
        await client.query("UPDATE app.identity_users SET email_verified_at=clock_timestamp() WHERE id=$1", [user.id]);
      } else {
        await client.query("UPDATE app.identity_users SET password_hash=$1 WHERE id=$2", [await hashPassword(password), user.id]);
        await this.queueMail(client, user, "password-changed");
      }
      await client.query("DELETE FROM app.identity_sessions WHERE user_id=$1", [user.id]);
      await client.query("DELETE FROM app.identity_actions WHERE user_id=$1", [user.id]);
      await client.query("DELETE FROM app.identity_mail WHERE user_id=$1 AND purpose IN ('verify-email','reset-password')", [user.id]);
      await this.audit(client, purpose === "verify-email" ? "auth.email_verified" : "auth.password_reset", requestId, user.id);
    });
    return purpose === "verify-email" ? { emailVerified: true, signInRequired: true } : { passwordReset: true, signInRequired: true };
  }
  private async factor(client: pg.PoolClient, user: User, code: unknown, requestId: string): Promise<boolean> {
    if (!user.mfa_secret || typeof code !== "string") return false;
    const key = await this.key(client);
    const step = matchTotp(unseal(key, "totp:" + user.id, user.mfa_secret), code, Date.now(), Number(user.mfa_last_step));
    if (step !== undefined) {
      await client.query("UPDATE app.identity_users SET mfa_last_step=$1 WHERE id=$2", [step, user.id]); return true;
    }
    if (!/^[a-f0-9]{32}$/.test(code)) return false;
    const used = await client.query("DELETE FROM app.identity_recovery_codes WHERE user_id=$1 AND code_hash=$2 RETURNING code_hash", [user.id, digest(user.id + ":" + code)]);
    if (!used.rowCount) return false;
    await this.audit(client, "auth.recovery_used", requestId, user.id);
    await this.queueMail(client, user, "recovery-used"); return true;
  }
  private async recoveryCodes(client: pg.PoolClient, userId: string): Promise<string[]> {
    const codes = Array.from({ length: 10 }, () => randomBytes(16).toString("hex"));
    await client.query("DELETE FROM app.identity_recovery_codes WHERE user_id=$1", [userId]);
    await client.query("INSERT INTO app.identity_recovery_codes(user_id,code_hash) SELECT $1,unnest($2::text[])", [userId, codes.map(code => digest(userId + ":" + code))]);
    return codes;
  }
  async mfaStart(token: unknown, input: unknown, ip: string, requestId: string) {
    const body = exactObject(input, ["password", "code"]), password = passwordValue(body.password);
    const result = await this.authenticated(token, async (client, user, session) => {
      await this.throttle(user.id, ip, ":mfa", 10, 60);
      if (!user.email_verified_at) throw new IdentityError(403, "EMAIL_VERIFICATION_REQUIRED");
      const key = await this.key(client);
      if (!(await verifyPassword(password, user.password_hash)) || (user.mfa_secret && !(await this.factor(client, user, body.code, requestId)))) {
        await this.audit(client, "auth.mfa_failed", requestId, user.id); return undefined;
      }
      const secret = base32(randomBytes(20));
      await client.query(`INSERT INTO app.identity_mfa_pending(user_id,session_hash,secret,expires_at)
        VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes') ON CONFLICT(user_id)
        DO UPDATE SET session_hash=$2,secret=$3,expires_at=clock_timestamp()+interval '10 minutes'`,
      [user.id, session.token_hash, seal(key, "pending:" + user.id, secret)]);
      return { secret, otpauthUri: `otpauth://totp/${encodeURIComponent("JeriFlow:" + user.email)}?secret=${secret}&issuer=JeriFlow&algorithm=SHA1&digits=6&period=30`, expiresInSeconds: 600 };
    });
    if (!result) throw new IdentityError(401, "INVALID_FACTOR"); return result;
  }
  async mfaConfirm(token: unknown, input: unknown, ip: string, requestId: string) {
    const body = exactObject(input, ["code"]);
    const result = await this.authenticated(token, async (client, user, session) => {
      await this.throttle(user.id, ip, ":mfa", 10, 60);
      if (!user.email_verified_at) throw new IdentityError(403, "EMAIL_VERIFICATION_REQUIRED");
      const key = await this.key(client);
      const pending = await client.query("SELECT secret FROM app.identity_mfa_pending WHERE user_id=$1 AND session_hash=$2 AND expires_at>clock_timestamp()", [user.id, session.token_hash]);
      const secret = pending.rowCount ? unseal(key, "pending:" + user.id, pending.rows[0].secret) : undefined;
      const step = secret ? matchTotp(secret, body.code, Date.now()) : undefined;
      if (step === undefined || !secret) { await this.audit(client, "auth.mfa_failed", requestId, user.id); return undefined; }
      const updated = await client.query(`UPDATE app.identity_users SET mfa_secret=$1,mfa_version=mfa_version+1,mfa_last_step=$2 WHERE id=$3 RETURNING *`,
        [seal(key, "totp:" + user.id, secret), step, user.id]);
      const codes = await this.recoveryCodes(client, user.id);
      await client.query("DELETE FROM app.identity_sessions WHERE user_id=$1", [user.id]);
      await this.queueMail(client, user, "mfa-changed");
      await this.audit(client, "auth.mfa_enrolled", requestId, user.id);
      return { ...await this.issueSession(client, updated.rows[0], true), recoveryCodes: codes };
    });
    if (!result) throw new IdentityError(401, "INVALID_FACTOR"); return result;
  }
  async mfaChallenge(token: unknown, input: unknown, ip: string, requestId: string) {
    const body = exactObject(input, ["code"]);
    const result = await this.authenticated(token, async (client, user, session) => {
      await this.throttle(user.id, ip, ":mfa", 10, 60);
      const { state } = await this.security(client, user, session);
      if (state.nextStep !== "mfa_challenge") throw new IdentityError(409, "MFA_CHALLENGE_NOT_PENDING");
      if (session.created_at.getTime() < Date.now() - 600_000) throw new IdentityError(401, "REAUTHENTICATION_REQUIRED");
      if (!(await this.factor(client, user, body.code, requestId))) { await this.audit(client, "auth.mfa_failed", requestId, user.id); return undefined; }
      await client.query("DELETE FROM app.identity_sessions WHERE token_hash=$1", [session.token_hash]);
      await this.audit(client, "auth.mfa_success", requestId, user.id);
      return this.issueSession(client, user, true);
    });
    if (!result) throw new IdentityError(401, "INVALID_FACTOR"); return result;
  }
  async mfaRecoveryCodes(token: unknown, input: unknown, ip: string, requestId: string) {
    const body = exactObject(input, ["password", "code"]), password = passwordValue(body.password);
    const result = await this.authenticated(token, async (client, user, session) => {
      await this.throttle(user.id, ip, ":mfa", 10, 60);
      const { state } = await this.security(client, user, session);
      if (state.nextStep !== "ready" || !user.mfa_secret) throw new IdentityError(403, "MFA_REQUIRED");
      if (!(await verifyPassword(password, user.password_hash)) || !(await this.factor(client, user, body.code, requestId))) {
        await this.audit(client, "auth.mfa_failed", requestId, user.id); return undefined;
      }
      const codes = await this.recoveryCodes(client, user.id);
      await client.query("DELETE FROM app.identity_sessions WHERE user_id=$1 AND token_hash<>$2", [user.id, session.token_hash]);
      await this.queueMail(client, user, "mfa-changed");
      await this.audit(client, "auth.recovery_rotated", requestId, user.id);
      return { recoveryCodes: codes };
    });
    if (!result) throw new IdentityError(401, "INVALID_FACTOR"); return result;
  }

  private async registrationCode(client: pg.PoolClient, user: User) {
    const token = randomBytes(32).toString("base64url");
    await client.query(`INSERT INTO app.identity_actions(token_hash,user_id,purpose,auth_version,expires_at)
      VALUES($1,$2,'complete-registration',$3,clock_timestamp()+interval '30 minutes') ON CONFLICT(user_id,purpose)
      DO UPDATE SET token_hash=$1,auth_version=$3,expires_at=clock_timestamp()+interval '30 minutes'`, [digest(token),user.id,user.auth_version]);
    await this.queueMail(client,user,"complete-registration",token);
  }
  private accountFailure(error: unknown): never {
    const e = error as { code?: string; message?: string };
    const status: Record<string, number> = { JF001:400, JF002:400, JF003:403, JF004:404, JF005:409 };
    const known = ["INVALID_INPUT","INVALID_OR_EXPIRED_TOKEN","FORBIDDEN","INVALID_PUBLIC_PROFILE","MUNICIPALITY_UNAVAILABLE",
      "MEMBERSHIP_SUSPENDED","MUNICIPALITY_CONFLICT","ACCOUNT_EXISTS_USE_MANAGEMENT","ACCOUNT_NOT_FOUND","PROTECTED_ACCOUNT","STALE_REVISION"];
    if (e.code && status[e.code] && known.includes(e.message ?? "")) throw new IdentityError(status[e.code],e.message!);
    throw error;
  }
  private page(value: { items: { id: string }[] }) {
    const more = value.items.length>50, items = value.items.slice(0,50);
    return { items, next: more ? items.at(-1)!.id : null };
  }
  async requestRegistration(input: unknown, ip: string, requestId: string) {
    const email = emailAddress(exactObject(input,["email"]).email);
    try { await this.throttle(email,ip,":registration",3,20); }
    catch (error) { if (error instanceof IdentityError && error.status===429) return { accepted:true }; throw error; }
    // Senha aleatória desconhecida e login bloqueado até o destinatário concluir.
    const hash = await hashPassword(randomBytes(32).toString("base64url"));
    await this.transaction(async client => {
      await this.key(client);
      const created = await client.query("SELECT app.registration_prepare($1,$2) AS id",[email,hash]);
      const user = await this.lockUser(client,created.rows[0].id);
      if (!user?.active || !user.registration_pending || user.platform_admin) return;
      await this.registrationCode(client,user);
      await this.audit(client,"account.registration_requested",requestId,user.id);
    });
    return { accepted:true };
  }
  async completeRegistration(input: unknown, ip: string, requestId: string) {
    const body = exactObject(input,["token","displayName","password"]);
    const token = actionHash(body.token), name = displayName(body.displayName), password = passwordValue(body.password);
    await this.throttle(token,ip,":registration-complete",5,30);
    const hash = await hashPassword(password);
    try { await this.transaction(async client => {
      await client.query("SELECT app.registration_complete($1,$2,$3,$4)",[token,name,hash,uuid(requestId)]);
    }); } catch (error) { this.accountFailure(error); }
    return { registered:true, signInRequired:true };
  }
  async municipalities(input: unknown, ip: string) {
    const body = exactObject(input,["after"]), after = body.after === undefined ? null : uuid(body.after);
    await this.throttle("directory",ip,":directory",10000,120);
    const r = await this.pool.query("SELECT app.public_municipalities($1) AS value",[after]);
    return this.page(r.rows[0].value);
  }
  async joinPublicProfile(token: unknown, input: unknown, ip: string, requestId: string) {
    const profile = publicProfile(input);
    try { await this.authenticated(token,async (client,user,session) => {
      const { state } = await this.security(client,user,session);
      if (state.nextStep!=="ready") throw new IdentityError(403,"FORBIDDEN");
      await this.throttle(user.id,ip,":public-join",10,60);
      await client.query("SELECT app.public_join($1,$2,$3,$4)",[session.token_hash,profile.municipalityId,profile.role,uuid(requestId)]);
    }); } catch (error) { this.accountFailure(error); }
    return { joined:true };
  }
  async manageQuery(token: unknown,input: unknown,ip: string,requestId: string) {
    const body = managementQuery(input);
    const result = await this.authenticated(token,async (client,user,session) => {
      const { state } = await this.security(client,user,session);
      if (!user.platform_admin || state.nextStep!=="ready") {
        await this.audit(client,"account.management_denied",requestId,user.id); return undefined;
      }
      await this.throttle(user.id,ip,":management-read",120,180);
      const r = await client.query("SELECT app.management_query($1,$2,$3,$4) AS value",[session.token_hash,body.kind,body.after,body.municipalityId]);
      await this.audit(client,"account.management_read",requestId,user.id);
      return this.page(r.rows[0].value);
    });
    if (!result) throw new IdentityError(403,"FORBIDDEN"); return result;
  }
  async manageMutation(token: unknown,input: unknown,ip: string,requestId: string) {
    const { data,password,code } = managementMutation(input);
    try {
      const result = await this.authenticated(token,async (client,user,session) => {
        const { state } = await this.security(client,user,session);
        if (!user.platform_admin || state.nextStep!=="ready") {
          await this.audit(client,"account.management_denied",requestId,user.id); return { denied:"FORBIDDEN" };
        }
        await this.throttle(user.id,ip,":management-write",10,60);
        if (!(await verifyPassword(password,user.password_hash)) || !(await this.factor(client,user,code,requestId))) {
          await this.audit(client,"account.management_denied",requestId,user.id); return { denied:"INVALID_FACTOR" };
        }
        await this.key(client);
        const placeholder = data.operation==="invite" ? await hashPassword(randomBytes(32).toString("base64url")) : null;
        const r = await client.query("SELECT app.management_mutate($1,$2::jsonb,$3,$4) AS value",[session.token_hash,JSON.stringify(data),placeholder,uuid(requestId)]);
        if (r.rows[0].value.userId) {
          const target = await this.lockUser(client,r.rows[0].value.userId);
          if (target?.active && target.registration_pending) await this.registrationCode(client,target);
          else if (target) await this.queueMail(client,target,"access-changed");
        }
        return { value:r.rows[0].value };
      });
      if (result.denied) throw new IdentityError(result.denied==="FORBIDDEN" ? 403 : 401,result.denied);
      return { changed:true,...result.value };
    } catch (error) { this.accountFailure(error); }
  }
  // Worker interno, não é rota HTTP. SKIP LOCKED permite mais de uma instância.

  // Funções SQL verificam novamente o hash da sessão e o vínculo no município.
  // O resultado nunca confia em permissões informadas pelo cliente.
  private ouvidoriaError(error: unknown): never {
    if (error instanceof IdentityError) throw error;
    const code = (error as { code?: string })?.code;
    const names: Record<string, [number, string]> = {
      JF001: [400, "INVALID_INPUT"], JF003: [403, "FORBIDDEN"],
      JF004: [404, "NOT_FOUND"], JF005: [409, "CONFLICT"],
    };
    if (code && names[code]) throw new IdentityError(...names[code]);
    throw error;
  }

  async ouvidoriaNoticesQuery(token:unknown,input:unknown,_requestId:string){
    const data=exactObject(input,["municipalityId","after"]);
    const mid=uuid(data.municipalityId),after=data.after===undefined?null:uuid(data.after);
    try{return await this.authenticated(token,async(client,user,session)=>{
      const {state}=await this.security(client,user,session);
      if(state.nextStep!=="ready")throw new IdentityError(403,"SECURITY_STEP_REQUIRED");
      const result=(await client.query("SELECT app.ouvidoria_notices_query($1,$2,$3) AS result",
        [sessionHash(token),mid,after])).rows[0]?.result;
      if(!Array.isArray(result?.items)||result.items.length>21||
        !Number.isSafeInteger(result.unreadCount)||result.unreadCount<0||
        !Number.isSafeInteger(result.totalCount)||result.totalCount<result.unreadCount)
        throw new IdentityError(503,"NOTICES_UNAVAILABLE");
      return {items:result.items.slice(0,20),next:result.items.length>20?result.items[19].id:null,
        unreadCount:result.unreadCount,totalCount:result.totalCount};
    });}catch(error){return this.ouvidoriaError(error);}
  }
  async ouvidoriaNoticeRead(token:unknown,input:unknown,_requestId:string){
    const data=exactObject(input,["municipalityId","noticeId"]);
    if(Object.keys(data).length!==2)throw new IdentityError(400,"INVALID_INPUT");
    const mid=uuid(data.municipalityId),id=uuid(data.noticeId);
    try{return await this.authenticated(token,async(client,user,session)=>{
      const {state}=await this.security(client,user,session);
      if(state.nextStep!=="ready")throw new IdentityError(403,"SECURITY_STEP_REQUIRED");
      const q=await client.query("SELECT app.ouvidoria_notice_read($1,$2,$3) AS result",[sessionHash(token),mid,id]);
      if(q.rows[0]?.result!==true)throw new IdentityError(503,"NOTICES_UNAVAILABLE");
      return {read:true};
    });}catch(error){return this.ouvidoriaError(error);}
  }
  async ouvidoriaRetentionReview(token:unknown,input:unknown,requestId:string){
    const data=exactObject(input,["municipalityId","protocolId"]);
    if(Object.keys(data).length!==2)throw new IdentityError(400,"INVALID_INPUT");
    const mid=uuid(data.municipalityId),pid=uuid(data.protocolId);
    try{return await this.authenticated(token,async(client,user,session)=>{
      const {state}=await this.security(client,user,session);
      if(state.nextStep!=="ready")throw new IdentityError(403,"SECURITY_STEP_REQUIRED");
      return (await client.query("SELECT app.ouvidoria_retention_review($1,$2,$3,$4) AS result",
        [sessionHash(token),mid,pid,uuid(requestId)])).rows[0]?.result;
    });}catch(error){return this.ouvidoriaError(error);}
  }

  async ouvidoriaRetentionInventory(token:unknown,input:unknown,requestId:string){
    const raw=exactObject(input,["municipalityId"]);
    if(Object.keys(raw).length!==1)throw new IdentityError(400,"INVALID_INPUT");
    const mid=uuid(raw.municipalityId);
    try{return await this.authenticated(token,async(client,user,session)=>{
      const {state}=await this.security(client,user,session);
      if(state.nextStep!=="ready")throw new IdentityError(403,"SECURITY_STEP_REQUIRED");
      const result=(await client.query("SELECT app.ouvidoria_governance_inventory($1,$2,$3) AS result",
        [sessionHash(token),mid,uuid(requestId)])).rows[0]?.result;
      if(!result||result.automaticDeletionEnabled!==false||!Array.isArray(result.inventory))
        throw new IdentityError(503,"RETENTION_UNAVAILABLE");
      return result;
    });}catch(error){return this.ouvidoriaError(error);}
  }
  async ouvidoriaRetentionDraft(token:unknown,input:unknown,requestId:string){
    const raw=exactObject(input,["municipalityId","category","retentionDays"]);
    if(Object.keys(raw).length!==3||!["denuncia","reclamacao","solicitacao","sugestao"].includes(String(raw.category))
      || !(raw.retentionDays===null||(Number.isSafeInteger(raw.retentionDays)
        && Number(raw.retentionDays)>=1&&Number(raw.retentionDays)<=36500)))
      throw new IdentityError(400,"INVALID_INPUT");
    const mid=uuid(raw.municipalityId);
    try{return await this.authenticated(token,async(client,user,session)=>{
      const {state}=await this.security(client,user,session);
      if(state.nextStep!=="ready")throw new IdentityError(403,"SECURITY_STEP_REQUIRED");
      return (await client.query("SELECT app.ouvidoria_governance_draft($1,$2,$3,$4,$5) AS result",
       [sessionHash(token),mid,raw.category,raw.retentionDays,uuid(requestId)])).rows[0]?.result;
    });}catch(error){return this.ouvidoriaError(error);}
  }
  async ouvidoriaRetentionArchive(token:unknown,input:unknown,requestId:string){
    const raw=exactObject(input,["municipalityId","protocolId","archived"]);
    if(Object.keys(raw).length!==3||typeof raw.archived!=="boolean")
      throw new IdentityError(400,"INVALID_INPUT");
    const mid=uuid(raw.municipalityId),pid=uuid(raw.protocolId);
    try{return await this.authenticated(token,async(client,user,session)=>{
      const {state}=await this.security(client,user,session);
      if(state.nextStep!=="ready")throw new IdentityError(403,"SECURITY_STEP_REQUIRED");
      return (await client.query("SELECT app.ouvidoria_governance_archive($1,$2,$3,$4,$5) AS result",
       [sessionHash(token),mid,pid,raw.archived,uuid(requestId)])).rows[0]?.result;
    });}catch(error){return this.ouvidoriaError(error);}
  }

  async guardaQuery(token:unknown,input:unknown,_requestId:string){
    const data=exactObject(input,["municipalityId","after"]);
    const mid=uuid(data.municipalityId),after=data.after===undefined?null:uuid(data.after);
    try{return await this.authenticated(token,async(client,user,session)=>{
      const {state}=await this.security(client,user,session);
      if(state.nextStep!=="ready")throw new IdentityError(403,"SECURITY_STEP_REQUIRED");
      const result=(await client.query("SELECT app.guarda_query($1,$2,$3) AS result",
        [sessionHash(token),mid,after])).rows[0]?.result;
      if(!Array.isArray(result?.items)||result.items.length>21)throw new IdentityError(503,"GUARDA_UNAVAILABLE");
      return {items:result.items.slice(0,20),next:result.items.length>20?result.items[19].id:null};
    });}catch(error){return this.ouvidoriaError(error);}
  }
  async guardaMutation(token:unknown,input:unknown,requestId:string){
    const raw=exactObject(input,["municipalityId","operation","clientRequestId","kind","title","description","occurrenceId","revision"]);
    const mid=uuid(raw.municipalityId),op=raw.operation;
    if(op!=="create"&&op!=="review"&&op!=="close")throw new IdentityError(400,"INVALID_INPUT");
    const body:Record<string,unknown>={municipalityId:mid,operation:op};
    if(op==="create"){
      if(Object.keys(raw).length!==6||typeof raw.title!=="string"||typeof raw.description!=="string"||
        raw.title.length<8||raw.title.length>120||raw.description.length<20||raw.description.length>2000||
        !["ocorrencia","apoio","orientacao","outro"].includes(String(raw.kind)))
          throw new IdentityError(400,"INVALID_INPUT");
      Object.assign(body,{clientRequestId:uuid(raw.clientRequestId),kind:raw.kind,title:raw.title,description:raw.description});
    }else{
      if(Object.keys(raw).length!==4||!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1)
        throw new IdentityError(400,"INVALID_INPUT");
      Object.assign(body,{occurrenceId:uuid(raw.occurrenceId),revision:raw.revision});
    }
    try{return await this.authenticated(token,async(client,user,session)=>{
      const {state}=await this.security(client,user,session);
      if(state.nextStep!=="ready")throw new IdentityError(403,"SECURITY_STEP_REQUIRED");
      const result=(await client.query("SELECT app.guarda_mutate($1,$2::jsonb,$3) AS result",
        [sessionHash(token),JSON.stringify(body),uuid(requestId)])).rows[0]?.result;
      if(!result?.occurrenceId)throw new IdentityError(503,"GUARDA_UNAVAILABLE");
      return result;
    });}catch(error){return this.ouvidoriaError(error);}
  }
  async ouvidoriaQuery(token: unknown, input: unknown, _requestId: string) {
    const body = ouvidoriaQuery(input);
    try {
      return await this.authenticated(token, async (client, user, session) => {
        const { state } = await this.security(client, user, session);
        if (state.nextStep !== "ready") throw new IdentityError(403, "SECURITY_STEP_REQUIRED");
        const result = await client.query("SELECT app.ouvidoria_query($1,$2::jsonb) AS result",
          [sessionHash(token), JSON.stringify(body)]);
        const items: unknown = result.rows[0]?.result?.items;
        if (!Array.isArray(items) || items.length > 21) throw new IdentityError(503, "OUVIDORIA_UNAVAILABLE");
        return { items: items.slice(0, 20), next: items.length > 20 ? items[19].id : null };
      });
    } catch (error) { return this.ouvidoriaError(error); }
  }
  async ouvidoriaHistory(token: unknown, input: unknown, _requestId: string) {
    const body = exactObject(input, ["municipalityId", "protocolId"]);
    const municipalityId = uuid(body.municipalityId), protocolId = uuid(body.protocolId);
    if (Object.keys(body).length !== 2) throw new IdentityError(400, "INVALID_INPUT");
    try {
      return await this.authenticated(token, async (client, user, session) => {
        const { state } = await this.security(client, user, session);
        if (state.nextStep !== "ready") throw new IdentityError(403, "SECURITY_STEP_REQUIRED");
        const result = await client.query("SELECT app.ouvidoria_history($1,$2,$3) AS result",
          [sessionHash(token), municipalityId, protocolId]);
        const items: unknown = result.rows[0]?.result?.items;
        if (!Array.isArray(items) || items.length > 20) throw new IdentityError(503, "OUVIDORIA_UNAVAILABLE");
        return { items };
      });
    } catch (error) { return this.ouvidoriaError(error); }
  }
  async ouvidoriaAttachmentUpload(token:unknown,input:unknown,requestId:string) {
    const body=attachmentInput(input);
    try{
      return await this.authenticated(token,async(client,user,session)=>{
        const {state}=await this.security(client,user,session);
        if(state.nextStep!=="ready")throw new IdentityError(403,"SECURITY_STEP_REQUIRED");
        const key=await this.key(client);
        const encrypted=encryptAttachment(key,body.municipalityId,body.protocolId,body.clientRequestId,body.bytes);
        const data={municipalityId:body.municipalityId,protocolId:body.protocolId,
          clientRequestId:body.clientRequestId,fileName:body.fileName,mediaType:body.mediaType,sizeBytes:body.sizeBytes};
        const result=await client.query(
          "SELECT app.ouvidoria_attachment_put($1,$2::jsonb,$3,$4,$5) AS result",
          [sessionHash(token),JSON.stringify(data),encrypted,body.sha256,uuid(requestId)]);
        const item=result.rows[0]?.result;
        if(!item?.attachmentId||item.status!=="quarantined")throw new IdentityError(503,"ATTACHMENT_UNAVAILABLE");
        return item;
      });
    }catch(e){return this.ouvidoriaError(e);}
  }
  async ouvidoriaAttachmentReadTest(token:unknown,input:unknown,requestId:string) {
    // Esta rota NAO pode ser habilitada em producao por variavel de ambiente.
    if(process.env.NODE_ENV!=="test" || process.env.JERIFLOW_ATTACHMENT_READ_TEST_ONLY!=="1")
      throw new IdentityError(503,"FEATURE_DISABLED");
    const body=exactObject(input,["municipalityId","protocolId","attachmentId"]);
    if(Object.keys(body).length!==3)throw new IdentityError(400,"INVALID_INPUT");
    const municipalityId=uuid(body.municipalityId),protocolId=uuid(body.protocolId),
      attachmentId=uuid(body.attachmentId);
    try{
      return await this.authenticated(token,async(client,user,session)=>{
        const {state}=await this.security(client,user,session);
        if(state.nextStep!=="ready")throw new IdentityError(403,"SECURITY_STEP_REQUIRED");
        const result=await client.query(
          "SELECT * FROM app.ouvidoria_attachment_read_test($1,$2,$3,$4,$5)",
          [sessionHash(token),municipalityId,protocolId,attachmentId,uuid(requestId)]);
        const a=result.rows[0];
        if(!a)throw new IdentityError(404,"NOT_FOUND");
        const decrypted=decryptAttachment(await this.key(client),municipalityId,protocolId,
          a.client_request_id,Buffer.from(a.encrypted_bytes));
        try{
          if(decrypted.length!==a.size_bytes||
            createHash("sha256").update(decrypted).digest("hex")!==a.sha256)
            throw new IdentityError(503,"ATTACHMENT_INTEGRITY_FAILURE");
          return {attachmentId,fileName:a.file_name,mediaType:a.media_type,
            sizeBytes:a.size_bytes,dataBase64:decrypted.toString("base64")};
        }finally{decrypted.fill(0)}
      });
    }catch(error){return this.ouvidoriaError(error)}
  }
  async ouvidoriaAttachmentList(token:unknown,input:unknown,_requestId:string) {
    const body=attachmentListInput(input);
    try{
      return await this.authenticated(token,async(client,user,session)=>{
        const {state}=await this.security(client,user,session);
        if(state.nextStep!=="ready")throw new IdentityError(403,"SECURITY_STEP_REQUIRED");
        const result=await client.query(
          "SELECT app.ouvidoria_attachment_list($1,$2,$3) AS result",
          [sessionHash(token),body.municipalityId,body.protocolId]);
        const items=result.rows[0]?.result?.items;
        if(!Array.isArray(items)||items.length>5)throw new IdentityError(503,"ATTACHMENT_UNAVAILABLE");
        return {items};
      });
    }catch(e){return this.ouvidoriaError(e);}
  }
  async ouvidoriaMutation(token: unknown, input: unknown, requestId: string) {
    const body = ouvidoriaMutation(input);
    try {
      return await this.authenticated(token, async (client, user, session) => {
        const { state } = await this.security(client, user, session);
        if (state.nextStep !== "ready") throw new IdentityError(403, "SECURITY_STEP_REQUIRED");
        const result = await client.query("SELECT app.ouvidoria_mutate($1,$2::jsonb,$3) AS result",
          [sessionHash(token), JSON.stringify(body), uuid(requestId)]);
        if (!result.rows[0]?.result?.protocolId) throw new IdentityError(503, "OUVIDORIA_UNAVAILABLE");
        return result.rows[0].result;
      });
    } catch (error) { return this.ouvidoriaError(error); }
  }
  async deliverMailBatch() {
    let delivered = 0, failed = 0;
    for (let i = 0; i < 10; i++) {
      const state = await this.transaction(async client => {
        const key = await this.key(client);
        await client.query("DELETE FROM app.identity_mail WHERE expires_at<=clock_timestamp()");
        const selected = await client.query(`SELECT * FROM app.identity_mail WHERE attempts<5 AND available_at<=clock_timestamp()
          ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
        if (!selected.rowCount) return "empty";
        const mail = selected.rows[0];
        try {
          const payload = JSON.parse(unseal(key, `mail:${mail.user_id}:${mail.purpose}`, mail.payload));
          await sendLocalIdentityMail(payload);
        } catch {
          await client.query(`UPDATE app.identity_mail SET attempts=attempts+1,available_at=clock_timestamp()+interval '1 minute' * power(2,attempts)
            WHERE user_id=$1 AND purpose=$2`, [mail.user_id, mail.purpose]);
          return "failed";
        }
        await client.query("DELETE FROM app.identity_mail WHERE user_id=$1 AND purpose=$2", [mail.user_id, mail.purpose]);
        return "delivered";
      });
      if (state === "empty") break;
      if (state === "delivered") delivered++; else failed++;
    }
    return { delivered, failed };
  }
}
