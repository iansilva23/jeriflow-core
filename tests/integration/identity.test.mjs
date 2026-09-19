import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createClient } from "redis";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { migrateIdentity, ownerClient, localIdentityConfiguration } from "../../scripts/identity-database.mjs";
import { provisionIdentity } from "../../scripts/identity-provision.mjs";
import { IdentityService } from "../../apps/api/src/identity.ts";
import { hashPassword, digest } from "../../apps/api/src/identity-primitives.ts";
import { createApp } from "../../apps/api/src/server.ts";
import { rolePermissions } from "../../packages/contracts/src/access.ts";

test("Identidade com PostgreSQL/Redis reais e contas fictícias isoladas", { timeout: 120_000 }, async t => {
  const root = fileURLToPath(new URL("../..", import.meta.url)), run = randomUUID();
  const config = localIdentityConfiguration(root), namespace = `jeriflow:test:${run}:login`;
  await migrateIdentity(root);
  assert.deepEqual(await migrateIdentity(root), [], "Migração repetida preserva o banco");
  const owner = ownerClient(root); await owner.connect();
  const app = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 2000 }); await app.connect();
  const cache = createClient({ url: config.redisUrl, socket: { reconnectStrategy: false } }); cache.on("error", () => {}); await cache.connect();
  const services = [], servers = [], users = [], emails = [], tenantIds = new Set(), requestIds = [];
  async function start(configuration = config) {
    const service = new IdentityService(configuration, { throttleNamespace: namespace }); services.push(service);
    const server = createApp(undefined, service); servers.push(server);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    return "http://127.0.0.1:" + server.address().port;
  }
  async function account(roles = ["cidadao"], tenant = "alpha", master = false) {
    const email = randomUUID() + "@example.invalid", password = randomBytes(24).toString("base64url");
    emails.push(email);
    const input = { email, password, displayName: "Conta fictícia", platformAdmin: master,
      municipalities: tenant ? [{ slug: `${tenant}-${run}`, displayName: `Município fictício ${tenant}`, roles }] : [] };
    const created = await provisionIdentity(root, input); users.push(created.userId);
    for (const m of created.municipalities) tenantIds.add(m.id);
    return { ...created, email, password, input, municipalityId: created.municipalities[0]?.id };
  }
  let base;
  async function request(path, { token, body, method, url = base, headers = {} } = {}) {
    const r = await fetch(url + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { ...headers, ...(token ? { Authorization: "Bearer " + token } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    requestIds.push(r.headers.get("x-request-id"));
    return { status: r.status, body: await r.json(), retry: r.headers.get("retry-after") };
  }
  async function login(a, url = base) {
    const r = await request("/auth/login", { url, body: { email: a.email, password: a.password } });
    assert.equal(r.status, 200); return r.body.accessToken;
  }
  try {
    base = await start(); const second = await start();
    await t.test("migração possui checksum e tabelas sob proprietário separado da API", async () => {
      const rows = await owner.query("SELECT name,sha256 FROM app.schema_migrations");
      assert.equal(rows.rows.find(r => r.name === "001-identity.sql").sha256, digest(readFileSync(new URL("../../infra/migrations/001-identity.sql", import.meta.url), "utf8")));
      const privileges = await app.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user");
      assert(Object.values(privileges.rows[0]).every(value => value === false));
    });
    const citizen = await account(), other = await account(["cidadao"], "beta"), fiscal = await account(["fiscal-tts"]);
    const master = await account([], null, true);
    await t.test("credenciais inválidas e campos de privilégio recebem recusa sem enumerar contas", async () => {
      const invalid = await request("/auth/login", { body: { email: citizen.email, password: "uma senha errada longa" } });
      const missingEmail = randomUUID() + "@example.invalid"; emails.push(missingEmail);
      const missing = await request("/auth/login", { body: { email: missingEmail, password: "uma senha errada longa" } });
      assert.equal(invalid.status, 401); assert.equal(missing.status, 401);
      assert.equal(invalid.body.error, missing.body.error);
      assert.equal((await request("/auth/login", { body: { email: citizen.email, password: citizen.password, platformAdmin: true } })).status, 400);
    });
    const token = await login(citizen);
    await t.test("sessão persiste entre instâncias e armazena somente hash do token", async () => {
      const r = await request("/auth/me", { token, url: second }); assert.equal(r.status, 200);
      assert.equal(r.body.user.id, citizen.userId); assert.equal(r.body.municipalities.length, 1);
      assert.equal(r.body.municipalities[0].id, citizen.municipalityId);
      assert(!JSON.stringify(r.body).includes("password")); assert.deepEqual(r.body.platformPermissions, []);
      const stored = await owner.query("SELECT token_hash FROM app.identity_sessions WHERE user_id=$1", [citizen.userId]);
      assert(stored.rows.some(row => row.token_hash === digest(token))); assert(!JSON.stringify(stored.rows).includes(token));
    });
    await t.test("cidadão não atravessa município, não vira Mestre e não acessa fiscal", async () => {
      const access = (tenant, permission) => request(`/access?municipalityId=${tenant}&permission=${encodeURIComponent(permission)}`, { token });
      assert.equal((await access(citizen.municipalityId, "mobile:cidadao:access")).status, 200);
      assert.equal((await access(other.municipalityId, "mobile:cidadao:access")).status, 403);
      assert.equal((await access(randomUUID(), "mobile:cidadao:access")).status, 403);
      assert.equal((await access(citizen.municipalityId, "mobile:fiscal-tts:access")).status, 403);
      assert.equal((await request("/access?permission=admin:mestre:access", { token })).status, 403);
    });
    await t.test("RLS nega contexto ausente e não deixa a conexão reutilizada vazar outro município", async () => {
      assert.equal((await app.query("SELECT * FROM app.memberships")).rowCount, 0);
      assert.equal((await app.query("SELECT * FROM app.municipalities")).rowCount, 0);
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.actor_id',$1,true)", [citizen.userId]);
      const visible = await app.query("SELECT id FROM app.municipalities"); assert.deepEqual(visible.rows.map(r => r.id), [citizen.municipalityId]);
      await app.query("COMMIT");
      assert.equal((await app.query("SELECT * FROM app.municipalities")).rowCount, 0);
      await assert.rejects(app.query("UPDATE app.identity_users SET platform_admin=true WHERE id=$1", [citizen.userId]), error => error.code === "42501");
      await assert.rejects(app.query("DELETE FROM app.identity_audit"), error => error.code === "42501");
      await assert.rejects(app.query("SELECT * FROM app.identity_audit"), error => error.code === "42501");
    });
    await t.test("Fiscal e administrativo TTS são separados; Mestre global não recebe dados municipais", async () => {
      const ftoken = await login(fiscal);
      assert.equal((await request(`/access?municipalityId=${fiscal.municipalityId}&permission=mobile:fiscal-tts:access`, { token: ftoken })).status, 200);
      assert.equal((await request(`/access?municipalityId=${fiscal.municipalityId}&permission=tts:admin:access`, { token: ftoken })).status, 403);
      const mtoken = await login(master), me = await request("/auth/me", { token: mtoken });
      assert.deepEqual(me.body.municipalities, []); assert.deepEqual(me.body.platformPermissions, ["admin:mestre:access"]);
      assert.equal((await request(`/access?municipalityId=${citizen.municipalityId}&permission=admin:semus:access`, { token: mtoken })).status, 403);
      const staff = await account(Object.keys(rolePermissions)), stoken = await login(staff);
      const grants = await request("/auth/me", { token: stoken });
      for (const permission of new Set(Object.values(rolePermissions).flat())) {
        assert(grants.body.municipalities[0].permissions.includes(permission));
        assert.equal((await request(`/access?municipalityId=${staff.municipalityId}&permission=${permission}`, { token: stoken })).status, 200);
      }
    });
    await t.test("retirar perfil ou desativar município revoga acesso na próxima requisição", async () => {
      await owner.query("UPDATE app.memberships SET active=false WHERE user_id=$1", [citizen.userId]);
      assert.equal((await request(`/access?municipalityId=${citizen.municipalityId}&permission=mobile:cidadao:access`, { token })).status, 403);
      await owner.query("UPDATE app.memberships SET active=true WHERE user_id=$1", [citizen.userId]);
      await owner.query("UPDATE app.municipalities SET active=false WHERE id=$1", [citizen.municipalityId]);
      assert.deepEqual((await request("/auth/me", { token })).body.municipalities, []);
      await owner.query("UPDATE app.municipalities SET active=true WHERE id=$1", [citizen.municipalityId]);
    });
    await t.test("logout revoga a sessão e logout-all revoga outras sessões", async () => {
      const a = await account(), one = await login(a), two = await login(a);
      assert.equal((await request("/auth/logout", { token: one, body: {} })).status, 200);
      assert.equal((await request("/auth/me", { token: one })).status, 401);
      assert.equal((await request("/auth/me", { token: two })).status, 200);
      const three = await login(a);
      assert.equal((await request("/auth/logout-all", { token: two, body: {} })).status, 200);
      assert.equal((await request("/auth/me", { token: three, url: second })).status, 401);
    });
    await t.test("expiração absoluta, inatividade, troca de senha e bloqueio da conta invalidam sessões", async () => {
      const a = await account();
      let tok = await login(a);
      await owner.query("UPDATE app.identity_sessions SET created_at=clock_timestamp()-interval '9 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE token_hash=$1", [digest(tok)]);
      assert.equal((await request("/auth/me", { token: tok })).status, 401);
      tok = await login(a);
      await owner.query("UPDATE app.identity_sessions SET last_seen_at=clock_timestamp()-interval '16 minutes' WHERE token_hash=$1", [digest(tok)]);
      assert.equal((await request("/auth/me", { token: tok })).status, 401);
      tok = await login(a);
      const newPassword = randomBytes(24).toString("base64url");
      await owner.query("UPDATE app.identity_users SET password_hash=$1 WHERE id=$2", [await hashPassword(newPassword), a.userId]);
      assert.equal((await request("/auth/me", { token: tok })).status, 401);
      const oldLogin = await request("/auth/login", { body: { email: a.email, password: a.password } }); assert.equal(oldLogin.status, 401);
      a.password = newPassword; tok = await login(a);
      await owner.query("UPDATE app.identity_users SET active=false WHERE id=$1", [a.userId]);
      assert.equal((await request("/auth/me", { token: tok })).status, 401);
      assert.equal((await request("/auth/login", { body: { email: a.email, password: a.password } })).status, 401);
    });
    await t.test("limite de tentativas é compartilhado entre duas instâncias", async () => {
      const email = randomUUID() + "@example.invalid"; emails.push(email);
      for (let i = 0; i < 10; i++) assert.equal((await request("/auth/login", { url: i % 2 ? second : base, body: { email, password: "senha fictícia inválida" } })).status, 401);
      const denied = await request("/auth/login", { body: { email, password: "senha fictícia inválida" } });
      assert.equal(denied.status, 429); assert(Number(denied.retry) > 0);
    });
    await t.test("falha de autenticação em Redis/PostgreSQL não libera login nem expõe credenciais", async () => {
      const wrongRedis = new URL(config.redisUrl); wrongRedis.password = randomBytes(32).toString("hex");
      const badCache = await start({ ...config, redisUrl: wrongRedis.href });
      const denied = await request("/auth/login", { url: badCache, body: { email: citizen.email, password: citizen.password } });
      assert.equal(denied.status, 503); assert(!JSON.stringify(denied.body).includes(wrongRedis.password));
      const wrongDatabase = new URL(config.databaseUrl); wrongDatabase.password = randomBytes(32).toString("hex");
      const badDb = await start({ ...config, databaseUrl: wrongDatabase.href });
      const unavailable = await request("/auth/me", { url: badDb, token });
      assert.equal(unavailable.status, 503); assert(!JSON.stringify(unavailable.body).includes(wrongDatabase.password));
    });
    await t.test("cadastro duplicado preserva senha e permissões existentes; auditoria registra recusa", async () => {
      await assert.rejects(provisionIdentity(root, { ...citizen.input, platformAdmin: true }), error => error.code === "23505");
      const user = await owner.query("SELECT platform_admin,password_hash FROM app.identity_users WHERE id=$1", [citizen.userId]);
      assert.equal(user.rows[0].platform_admin, false); assert(!user.rows[0].password_hash.includes(citizen.password));
      const audit = await owner.query("SELECT event_code FROM app.identity_audit WHERE request_id=ANY($1::uuid[])", [requestIds]);
      for (const code of ["auth.login_success", "auth.login_failed", "auth.access_denied", "auth.logout", "auth.logout_all"])
        assert(audit.rows.some(row => row.event_code === code), code);
    });
  } finally {
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    for (const service of services) await service.close();
    await owner.query("DELETE FROM app.identity_audit WHERE request_id=ANY($1::uuid[]) OR target_id=ANY($2::uuid[])", [requestIds.filter(Boolean), users]);
    await owner.query("DELETE FROM app.identity_users WHERE id=ANY($1::uuid[])", [users]);
    await owner.query("DELETE FROM app.municipalities WHERE id=ANY($1::uuid[])", [[...tenantIds]]);
    await cache.del([...emails.map(email => namespace + ":account:" + digest(email)), namespace + ":ip:" + digest("127.0.0.1")]);
    cache.destroy(); await app.end(); await owner.end();
  }
});
