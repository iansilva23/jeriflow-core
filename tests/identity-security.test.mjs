import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { base32, decodeBase32, totp, matchTotp, seal, unseal, actionHash, readIdentityKey } from "../apps/api/src/identity-security.ts";

test("TOTP corresponde a todos os vetores SHA-1 do RFC 6238, incluindo datas após 2038", () => {
  const secret = Buffer.from("12345678901234567890");
  for (const [timestamp, code] of [[59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],
    [1234567890,"89005924"],[2000000000,"69279037"],[20000000000,"65353130"]])
    assert.equal(totp(secret, Math.floor(timestamp / 30), 8), code);
  assert.equal(base32(secret), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(decodeBase32(base32(secret)), secret);
  for (let i = 0; i < 20; i++) { const b = randomBytes(20); assert(decodeBase32(base32(b)).equals(b)); }
});
test("TOTP recusa código reutilizado, fora da janela, formatos inválidos e segredos malformados", () => {
  const bytes = Buffer.from("12345678901234567890"), secret = base32(bytes), now = 1234567890000, step = Math.floor(now / 30000);
  for (const offset of [-1,0,1]) assert.equal(matchTotp(secret, totp(bytes, step + offset), now), step + offset);
  assert.equal(matchTotp(secret, totp(bytes, step), now, step), undefined);
  assert.equal(matchTotp(secret, totp(bytes, step - 2), now), undefined);
  for (const code of [null,123456," 123456","1234567",{},"abcdef"]) assert.equal(matchTotp(secret, code, now), undefined);
  assert.throws(() => decodeBase32("bad")); assert.throws(() => totp(bytes, -1));
});
test("AES-GCM autentica chave, usuário, finalidade e conteúdo; usa nonce aleatório", () => {
  const key = randomBytes(32), value = "segredo fictício", encrypted = seal(key, "totp:user-one", value);
  assert.equal(unseal(key, "totp:user-one", encrypted), value);
  assert.notEqual(encrypted, seal(key, "totp:user-one", value)); assert(!encrypted.includes(value));
  assert.throws(() => unseal(randomBytes(32), "totp:user-one", encrypted));
  assert.throws(() => unseal(key, "totp:user-two", encrypted));
  assert.throws(() => unseal(key, "pending:user-one", encrypted));
  const packed = Buffer.from(encrypted.slice(3), "base64url"); packed[packed.length-1] ^= 1;
  assert.throws(() => unseal(key, "totp:user-one", "v1." + packed.toString("base64url")));
});
test("Tokens de ação exigem 256 bits em representação canônica", () => {
  assert.match(actionHash(randomBytes(32).toString("base64url")), /^[a-f0-9]{64}$/);
  for (const value of [null,"", "a".repeat(42), "z".repeat(43), {},"../secret"])
    assert.throws(() => actionHash(value), error => error.code === "INVALID_OR_EXPIRED_TOKEN");
});
test("Chave local exige arquivo privado regular, sem symlink; nunca é recriada pela leitura", () => {
  const root = mkdtempSync(join(tmpdir(), "jeriflow-key-")), dir = join(root, ".secrets");
  try {
    mkdirSync(dir, { mode: 0o700 });
    assert.throws(() => readIdentityKey(root));
    const key = randomBytes(32); writeFileSync(join(dir,"identity-key"),key.toString("hex")+"\n",{mode:0o600});
    assert(readIdentityKey(root).equals(key));
    chmodSync(join(dir,"identity-key"),0o644); assert.throws(() => readIdentityKey(root));
    chmodSync(join(dir,"identity-key"),0o600); chmodSync(dir,0o755); assert.throws(() => readIdentityKey(root));
    chmodSync(dir,0o700); rmSync(join(dir,"identity-key"));
    writeFileSync(join(root,"target"),key.toString("hex")+"\n",{mode:0o600});
    symlinkSync(join(root,"target"),join(dir,"identity-key")); assert.throws(() => readIdentityKey(root));
  } finally { rmSync(root,{recursive:true,force:true}); }
});
