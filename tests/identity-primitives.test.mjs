import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword, sessionHash, emailAddress, exactObject, passwordValue, uuid } from "../apps/api/src/identity-primitives.ts";
import { permissionsFor, rolePermissions, permissionCatalog } from "../packages/contracts/src/access.ts";
import { mobileApps, adminPanels } from "../packages/contracts/src/catalog.ts";

test("senhas: salt exclusivo, verificação real, senha errada e hash adulterado recusados", async () => {
  const password = "  Senha longa com espaço e ç  " + randomUUID();
  const a = await hashPassword(password), b = await hashPassword(password);
  assert.notEqual(a, b); assert(!a.includes(password));
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword(password.trim(), a), false);
  assert.equal(await verifyPassword(password, a.replace("131072", "2")), false);
  assert.equal(await verifyPassword(password, undefined), false);
  assert.throws(() => passwordValue("curta"));
  assert.throws(() => passwordValue("x".repeat(129)));
});
test("tokens e entradas: formato canônico, normalização de email e campos imprevistos recusados", () => {
  assert.equal(emailAddress(" PESSOA+teste@Example.Invalid "), "pessoa+teste@example.invalid");
  assert.throws(() => emailAddress("a@invalid"));
  assert.throws(() => exactObject({ email: "a", role: "mestre" }, ["email", "password"]));
  assert.throws(() => exactObject([], []));
  const token = randomBytes(32).toString("base64url");
  assert.match(sessionHash(token), /^[a-f0-9]{64}$/);
  assert.throws(() => sessionHash(token + "="));
  assert.equal(uuid(randomUUID()).length, 36);
  assert.throws(() => uuid("' OR 1=1"));
});
test("perfis cobrem quatro apps e sete painéis; desconhecido, cidadão e fiscal não viram administradores", () => {
  for (const app of mobileApps) assert(permissionCatalog.includes(`mobile:${app.id}:access`));
  for (const panel of adminPanels) assert(permissionCatalog.includes(`admin:${panel.id}:access`));
  assert.deepEqual(permissionsFor(["cidadao", "cidadao", "__proto__", "constructor", "mestre", "unknown"]), ["mobile:cidadao:access"]);
  assert(!permissionsFor(["fiscal-tts"]).includes("tts:admin:access"));
  assert(!permissionsFor(Object.keys(rolePermissions)).includes("admin:mestre:access"));
  assert(permissionsFor(["admin-tts"]).includes("tts:admin:access"));
});
