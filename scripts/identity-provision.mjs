import { constants, openSync, fstatSync, readFileSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { ownerClient, migrateIdentity } from "./identity-database.mjs";
import { exactObject, emailAddress, displayName, hashPassword, IdentityError } from "../apps/api/src/identity-primitives.ts";
import { rolePermissions } from "../packages/contracts/src/access.ts";

export async function provisionIdentity(root, input) {
  const body = exactObject(input, ["email", "password", "displayName", "platformAdmin", "municipalities"]);
  const email = emailAddress(body.email), name = displayName(body.displayName);
  if (body.platformAdmin !== undefined && typeof body.platformAdmin !== "boolean") throw new IdentityError(400, "INVALID_INPUT");
  if (!Array.isArray(body.municipalities) || body.municipalities.length > 20) throw new IdentityError(400, "INVALID_INPUT");
  const tenants = body.municipalities.map(value => {
    const m = exactObject(value, ["slug", "displayName", "roles"]);
    if (typeof m.slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(m.slug)
      || !Array.isArray(m.roles) || !m.roles.length || m.roles.length > 11
      || new Set(m.roles).size !== m.roles.length || m.roles.some(r => typeof r !== "string" || !Object.hasOwn(rolePermissions, r)))
      throw new IdentityError(400, "INVALID_INPUT");
    return { slug: m.slug, displayName: displayName(m.displayName), roles: m.roles };
  });
  if (new Set(tenants.map(t => t.slug)).size !== tenants.length) throw new IdentityError(400, "INVALID_INPUT");
  const hash = await hashPassword(body.password);
  const client = ownerClient(root);
  try {
    await client.connect(); await client.query("BEGIN");
    const inserted = await client.query(`INSERT INTO app.identity_users(email,display_name,password_hash,platform_admin)
      VALUES ($1,$2,$3,$4) RETURNING id`, [email, name, hash, body.platformAdmin ?? false]);
    const userId = inserted.rows[0].id, municipalities = [];
    for (const tenant of tenants) {
      await client.query("INSERT INTO app.municipalities(slug,display_name) VALUES ($1,$2) ON CONFLICT(slug) DO NOTHING", [tenant.slug, tenant.displayName]);
      const result = await client.query("SELECT id,display_name,active FROM app.municipalities WHERE slug=$1", [tenant.slug]);
      const row = result.rows[0];
      if (!row?.active || row.display_name !== tenant.displayName) throw new IdentityError(409, "MUNICIPALITY_CONFLICT");
      for (const role of tenant.roles) await client.query("INSERT INTO app.memberships(user_id,municipality_id,role_code) VALUES ($1,$2,$3)", [userId, row.id, role]);
      municipalities.push({ id: row.id, roles: tenant.roles });
    }
    await client.query("INSERT INTO app.identity_audit(request_id,target_id,event_code) VALUES ($1,$2,'identity.provisioned')", [randomUUID(), userId]);
    await client.query("COMMIT");
    return { userId, municipalities };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { await client.end().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("ONE_PROTECTED_FILE_REQUIRED");
    const fd = openSync(resolve(process.argv[2]), constants.O_RDONLY | constants.O_NOFOLLOW);
    let body;
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.size > 16384 || (st.mode & 0o077) || (process.getuid && st.uid !== process.getuid())) throw new Error("PROTECTED_FILE_REQUIRED");
      body = JSON.parse(readFileSync(fd, "utf8"));
    } finally { closeSync(fd); }
    const root = fileURLToPath(new URL("..", import.meta.url));
    await migrateIdentity(root);
    const result = await provisionIdentity(root, body);
    console.log("Identidade criada: " + result.userId + ". Municípios vinculados: " + result.municipalities.length + ".");
  } catch {
    console.error("Cadastro não concluído. Confira arquivo privado, dados únicos, perfis e infraestrutura local. Nenhuma senha foi exibida.");
    process.exitCode = 1;
  }
}
