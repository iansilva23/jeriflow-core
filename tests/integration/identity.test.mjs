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
import { readIdentityKey, decodeBase32, totp, unseal } from "../../apps/api/src/identity-security.ts";
import { localMailbox } from "../../apps/api/src/identity-mail.ts";

test("Identidade, email e MFA com PostgreSQL/Redis/Mailpit reais e contas fictícias isoladas", { timeout: 150_000 }, async t => {
  const root = fileURLToPath(new URL("../..", import.meta.url)), run = randomUUID();
  const config = localIdentityConfiguration(root), namespace = `jeriflow:test:${run}:login`;
  await migrateIdentity(root);
  const encryptionKey = readIdentityKey(root);
  assert.deepEqual(await migrateIdentity(root), [], "Migração repetida preserva o banco");
  const owner = ownerClient(root); await owner.connect();
  const app = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 2000 }); await app.connect();
  const cache = createClient({ url: config.redisUrl, socket: { reconnectStrategy: false } }); cache.on("error", () => {}); await cache.connect();
  const services = [], servers = [], users = [], emails = [], tenantIds = new Set(), requestIds = [];
  async function start(configuration = config, key = encryptionKey) {
    const service = new IdentityService(configuration, { throttleNamespace: namespace, encryptionKey: key }); services.push(service);
    const server = createApp(undefined, service); servers.push(server);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    return "http://127.0.0.1:" + server.address().port;
  }
  async function account(roles = ["cidadao"], tenant = "alpha", master = false, verified = true) {
    const email = randomUUID() + "@example.invalid", password = randomBytes(24).toString("base64url");
    emails.push(email);
    const input = { email, password, displayName: "Conta fictícia", platformAdmin: master,
      municipalities: tenant ? [{ slug: `${tenant}-${run}`, displayName: `Município fictício ${tenant}`, roles }] : [] };
    const created = await provisionIdentity(root, input); users.push(created.userId);
    for (const m of created.municipalities) tenantIds.add(m.id);
    const a = { ...created, email, password, input, municipalityId: created.municipalities[0]?.id };
    if (verified) {
      const code = await requestMail(a, "email");
      assert.equal((await request("/auth/email/confirm", { body: { token: code } })).status, 200);
    }
    return a;
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
    assert.equal(r.status, 200);
    if (r.body.nextStep === "mfa_enrollment") {
      const enrolled = await enroll(a, r.body.accessToken, url); return enrolled.accessToken;
    }
    if (r.body.nextStep === "mfa_challenge") {
      const done = await request("/auth/mfa/challenge", { url, token: r.body.accessToken, body: { code: a.codes.shift() } });
      assert.equal(done.status, 200); return done.body.accessToken;
    }
    return r.body.accessToken;
  }
  const otp = (secret, offset = 0) => totp(decodeBase32(secret), Math.floor(Date.now()/30000) + offset);
  async function enroll(a, token, url = base, code) {
    const setup = await request("/auth/mfa/enroll/start", { url, token, body: { password: a.password, ...(code ? { code } : {}) } });
    assert.equal(setup.status, 200); a.secret = setup.body.secret;
    const confirmed = await request("/auth/mfa/enroll/confirm", { url, token, body: { code: otp(a.secret) } });
    assert.equal(confirmed.status, 200); a.codes = [...confirmed.body.recoveryCodes]; return confirmed.body;
  }
  async function mail(a, purpose) {
    const result = await services[0].deliverMailBatch(); assert.equal(result.failed, 0);
    const found = await fetch(localMailbox + "/api/v1/search?query=" + encodeURIComponent(`to:${a.email} tag:${purpose}`), { signal: AbortSignal.timeout(3000) });
    assert.equal(found.status, 200); const list = await found.json();
    assert(list.messages?.length > 0, "Mensagem entregue à caixa de teste");
    const detail = await fetch(localMailbox + "/api/v1/message/" + encodeURIComponent(list.messages[0].ID));
    assert.equal(detail.status, 200); return detail.json();
  }
  async function requestMail(a, kind) {
    const r = await request(`/auth/${kind}/request`, { body: { email: a.email } });
    assert.equal(r.status, 200); assert.deepEqual(r.body, { accepted: true });
    const message = await mail(a, kind === "email" ? "verify-email" : "reset-password");
    const code = message.Text.match(/^([A-Za-z0-9_-]{43})$/m)?.[1];
    assert(code, "Código recebido pelo transporte HTTP do Mailpit, não pelo retorno da API"); return code;
  }
  t.beforeEach(async () => {
    // Cada cenário tem sua própria janela de IP. Nunca alterar limites do serviço.
    const keys = (await cache.keys(namespace + "*")).filter(key => key.includes(":ip:"));
    if (keys.length) await cache.del(keys);
  });
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
    await t.test("email não confirmado restringe sessão; resposta pública não enumera contas", async () => {
      const a = await account(["cidadao"], "alpha", false, false), tok = await login(a);
      const me = await request("/auth/me", { token: tok });
      assert.equal(me.body.security.nextStep, "email_verification"); assert.deepEqual(me.body.municipalities, []);
      assert.equal((await request(`/access?municipalityId=${a.municipalityId}&permission=mobile:cidadao:access`, { token: tok })).body.error, "EMAIL_VERIFICATION_REQUIRED");
      assert.equal((await request("/auth/mfa/enroll/start", { token: tok, body: { password: a.password } })).status, 403);
      const unknown = randomUUID() + "@example.invalid";
      const one = await request("/auth/email/request", { body: { email: a.email } });
      const two = await request("/auth/email/request", { body: { email: unknown } });
      assert.deepEqual(one.body, two.body); assert.equal(one.status, two.status);
      const code = await requestMail(a, "email");
      assert.equal((await request("/auth/password/reset", { body: { token: code, password: a.password } })).status, 400);
      const confirmations = await Promise.all([base, second].map(url => request("/auth/email/confirm", { url, body: { token: code } })));
      assert.deepEqual(confirmations.map(r => r.status).sort(), [200,400]);
      assert.equal((await request("/auth/me", { token: tok })).status, 401, "Sessão anterior à confirmação é revogada");
      assert.equal((await request("/auth/me", { token: await login(a) })).body.security.nextStep, "ready");
      assert.equal((await request("/auth/email/confirm", { body: { token: code } })).status, 400);
    });
    await t.test("novo email invalida código anterior; expirados e GET não confirmam conta", async () => {
      const a = await account(["cidadao"], "alpha", false, false);
      const old = await requestMail(a, "email"), fresh = await requestMail(a, "email");
      assert(old !== fresh);
      assert.equal((await request("/auth/email/confirm", { body: { token: old } })).status, 400);
      assert.equal((await request("/auth/email/confirm")).status, 405);
      await owner.query("UPDATE app.identity_actions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [a.userId]);
      assert.equal((await request("/auth/email/confirm", { body: { token: fresh } })).status, 400);
      const user = await owner.query("SELECT email_verified_at FROM app.identity_users WHERE id=$1", [a.userId]);
      assert.equal(user.rows[0].email_verified_at, null);
    });
    await t.test("recuperação altera senha uma única vez, avisa por email e revoga todas as sessões", async () => {
      const a = await account(), before = await login(a), before2 = await login(a, second);
      const code = await requestMail(a, "password");
      const stored = await owner.query("SELECT token_hash FROM app.identity_actions WHERE user_id=$1", [a.userId]);
      assert(stored.rows.some(r => r.token_hash === digest(code))); assert(!JSON.stringify(stored.rows).includes(code));
      const next = randomBytes(24).toString("base64url");
      assert.equal((await request("/auth/password/reset", { body: { token: code, password: "short" } })).status, 400);
      const results = await Promise.all([base, second].map(url => request("/auth/password/reset", { url, body: { token: code, password: next } })));
      assert.deepEqual(results.map(r => r.status).sort(), [200,400]);
      for (const tok of [before,before2]) assert.equal((await request("/auth/me", { token: tok })).status, 401);
      assert.equal((await request("/auth/login", { body: { email: a.email, password: a.password } })).status, 401);
      a.password = next; assert.equal((await request("/auth/me", { token: await login(a) })).status, 200);
      assert((await mail(a, "password-changed")).Subject.includes("senha"));
      assert.equal((await request("/auth/password/reset", { body: { token: code, password: next } })).status, 400);
    });
    await t.test("administrador e Mestre não recebem permissão até cadastrar e comprovar MFA", async () => {
      const a = await account(["admin-tts"], "alpha", true);
      const raw = await request("/auth/login", { body: { email: a.email, password: a.password } }), tok = raw.body.accessToken;
      assert.equal(raw.body.nextStep, "mfa_enrollment");
      const me = await request("/auth/me", { token: tok }); assert.deepEqual(me.body.platformPermissions, []); assert.deepEqual(me.body.municipalities, []);
      assert.equal((await request("/access?permission=admin:mestre:access", { token: tok })).body.error, "MFA_REQUIRED");
      const ready = await enroll(a, tok);
      assert.equal(ready.nextStep, "ready"); assert.equal(a.codes.length, 10); assert.equal(new Set(a.codes).size, 10);
      assert.equal((await request("/auth/me", { token: tok })).status, 401);
      assert.equal((await request("/access?permission=admin:mestre:access", { token: ready.accessToken, url: second })).status, 200);
      const rows = await owner.query("SELECT mfa_secret FROM app.identity_users WHERE id=$1", [a.userId]);
      assert(rows.rows[0].mfa_secret !== a.secret && !rows.rows[0].mfa_secret.includes(a.secret));
      const hashes = await owner.query("SELECT code_hash FROM app.identity_recovery_codes WHERE user_id=$1", [a.userId]);
      assert.equal(hashes.rowCount, 10); assert(!JSON.stringify(hashes.rows).includes(a.codes[0]));
    });
    await t.test("MFA rejeita replay TOTP e código de recuperação concorrente; trocar senha não o remove", async () => {
      const a = await account(["admin-semus"]); await login(a);
      const freshLogin = async () => (await request("/auth/login", { body: { email: a.email, password: a.password } })).body.accessToken;
      const partial = await freshLogin(), partial2 = await freshLogin();
      const last = (await owner.query("SELECT mfa_last_step FROM app.identity_users WHERE id=$1", [a.userId])).rows[0].mfa_last_step;
      const usedOtp = totp(decodeBase32(a.secret), Number(last));
      assert.equal((await request("/auth/mfa/challenge", { token: partial, body: { code: usedOtp } })).status, 401);
      const extra = await freshLogin();
      const validOtp = await request("/auth/mfa/challenge", { token: extra, body: { code: otp(a.secret, 1) } });
      assert.equal(validOtp.status, 200); assert.equal(validOtp.body.nextStep, "ready");
      assert.equal((await request("/auth/me", { token: extra })).status, 401);
      const recovery = a.codes.shift();
      const results = await Promise.all([[base,partial],[second,partial2]].map(([url,token]) => request("/auth/mfa/challenge", { url, token, body: { code: recovery } })));
      assert.deepEqual(results.map(r => r.status).sort(), [200,401]);
      assert((await mail(a, "recovery-used")).Subject.includes("recuperação"));
      const reset = await requestMail(a, "password"), next = randomBytes(24).toString("base64url");
      assert.equal((await request("/auth/password/reset", { body: { token: reset, password: next } })).status, 200);
      a.password = next;
      const signIn = await request("/auth/login", { body: { email: a.email, password: next } });
      assert.equal(signIn.body.nextStep, "mfa_challenge");
      assert.equal((await request(`/access?municipalityId=${a.municipalityId}&permission=admin:semus:access`, { token: signIn.body.accessToken })).status, 403);
      assert.equal((await request("/auth/mfa/challenge", { token: signIn.body.accessToken, body: { code: a.codes.shift() } })).status, 200);
    });
    await t.test("elevação de perfil em sessão existente passa imediatamente a exigir MFA", async () => {
      const a = await account(), tok = await login(a);
      await owner.query("INSERT INTO app.memberships(user_id,municipality_id,role_code) VALUES($1,$2,'admin-conteudo')", [a.userId,a.municipalityId]);
      assert.equal((await request("/auth/me", { token: tok })).body.security.nextStep, "mfa_enrollment");
      assert.equal((await request(`/access?municipalityId=${a.municipalityId}&permission=admin:conteudo:access`, { token: tok })).status, 403);
    });
    await t.test("cadastro MFA é vinculado à sessão, vence, não substitui fator ativo sem prova", async () => {
      const a = await account(), tok = await login(a), otherToken = await login(a);
      const start = await request("/auth/mfa/enroll/start", { token: tok, body: { password: a.password } });
      assert.equal(start.status, 200);
      assert.equal((await request("/auth/mfa/enroll/confirm", { token: otherToken, body: { code: otp(start.body.secret) } })).status, 401);
      await owner.query("UPDATE app.identity_mfa_pending SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [a.userId]);
      assert.equal((await request("/auth/mfa/enroll/confirm", { token: tok, body: { code: otp(start.body.secret) } })).status, 401);
      const ready = await enroll(a, tok), oldCodes = [...a.codes], oldSecret = a.secret;
      assert.equal((await request("/auth/mfa/enroll/start", { token: ready.accessToken, body: { password: a.password } })).status, 401);
      const replacement = await enroll(a, ready.accessToken, base, a.codes.shift());
      assert(a.secret !== oldSecret); assert.equal((await request("/auth/me", { token: ready.accessToken })).status, 401);
      const hashes = await owner.query("SELECT code_hash FROM app.identity_recovery_codes WHERE user_id=$1", [a.userId]);
      assert(oldCodes.every(code => !hashes.rows.some(r => r.code_hash === digest(a.userId + ":" + code))));
      assert.equal((await request("/auth/me", { token: replacement.accessToken })).body.security.nextStep, "ready");
    });
    await t.test("rotacionar códigos exige senha e fator, invalida conjunto anterior e outras sessões", async () => {
      const a = await account(["admin-dashboard"]), tok = await login(a), otherToken = await login(a);
      const oldCodes = [...a.codes];
      const rotated = await request("/auth/mfa/recovery-codes", { token: tok, body: { password: a.password, code: a.codes.shift() } });
      assert.equal(rotated.status, 200); assert.equal(rotated.body.recoveryCodes.length, 10);
      assert(!rotated.body.recoveryCodes.some(code => oldCodes.includes(code)));
      assert.equal((await request("/auth/me", { token: otherToken })).status, 401);
      assert.equal((await request("/auth/me", { token: tok })).status, 200);
    });
    await t.test("limite MFA compartilhado impede força bruta mesmo criando novas sessões", async () => {
      const a = await account(["admin-studio"]); await login(a);
      const tok = (await request("/auth/login", { body: { email: a.email, password: a.password } })).body.accessToken;
      // O cadastro já usou duas das dez tentativas da janela.
      for (let i=0; i<8; i++) assert.equal((await request("/auth/mfa/challenge", { url: i%2 ? base : second, token: tok, body: { code: "invalid" } })).status, 401);
      const blocked = await request("/auth/mfa/challenge", { token: tok, body: { code: a.codes[0] } });
      assert.equal(blocked.status, 429); assert(Number(blocked.retry)>0);
    });
    await t.test("chave incorreta falha fechada e fila não expõe token em texto", async () => {
      const a = await account(["cidadao"], "alpha", false, false);
      await request("/auth/email/request", { body: { email: a.email } });
      const row = (await owner.query("SELECT payload FROM app.identity_mail WHERE user_id=$1 AND purpose='verify-email'", [a.userId])).rows[0];
      const decoded = JSON.parse(unseal(encryptionKey, `mail:${a.userId}:verify-email`, row.payload));
      assert(!row.payload.includes(decoded.token)); assert(!row.payload.includes(a.email));
      const wrongKey = await start(config, randomBytes(32));
      assert.equal((await request("/auth/email/request", { url: wrongKey, body: { email: a.email } })).status, 503);
      assert.equal((await request("/auth/email/request", { url: wrongKey, body: { email: randomUUID()+"@example.invalid" } })).status, 503);
      await assert.rejects(app.query("UPDATE app.identity_keys SET fingerprint=$1", ["0".repeat(64)]), error => error.code === "42501");
      const before = (await owner.query("SELECT attempts FROM app.identity_mail WHERE user_id=$1", [a.userId])).rows[0].attempts;
      await owner.query("UPDATE app.identity_mail SET payload='v1.invalid' WHERE user_id=$1", [a.userId]);
      const delivery = await services[0].deliverMailBatch(); assert.equal(delivery.failed, 1);
      const failed = await owner.query("SELECT attempts,available_at>clock_timestamp() AS delayed FROM app.identity_mail WHERE user_id=$1", [a.userId]);
      assert.equal(failed.rows[0].attempts, before+1); assert(failed.rows[0].delayed);
    });
    await t.test("auditoria registra confirmação, recuperação, MFA e recusas sem códigos ou senhas", async () => {
      const audit = await owner.query("SELECT event_code FROM app.identity_audit WHERE request_id=ANY($1::uuid[])", [requestIds]);
      for (const code of ["auth.email_verified","auth.password_reset","auth.mfa_enrolled","auth.mfa_success","auth.mfa_failed","auth.recovery_used","auth.recovery_rotated"])
        assert(audit.rows.some(r => r.event_code === code), code);
    });
  } finally {
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    for (const service of services) await service.close();
    await owner.query("DELETE FROM app.identity_audit WHERE request_id=ANY($1::uuid[]) OR target_id=ANY($2::uuid[])", [requestIds.filter(Boolean), users]);
    await owner.query("DELETE FROM app.identity_users WHERE id=ANY($1::uuid[])", [users]);
    await owner.query("DELETE FROM app.municipalities WHERE id=ANY($1::uuid[])", [[...tenantIds]]);
    const keys = await cache.keys(namespace + "*"); if (keys.length) await cache.del(keys);
    // Remove somente emails dessas contas fictícias; nunca limpa a caixa inteira.
    for (const email of emails) {
      const removed = await fetch(localMailbox + "/api/v1/search?query=" + encodeURIComponent("to:" + email), { method: "DELETE", signal: AbortSignal.timeout(3000) });
      await removed.body?.cancel();
    }
    cache.destroy(); await app.end(); await owner.end();
  }
});
