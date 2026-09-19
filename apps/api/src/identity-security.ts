import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants, openSync, fstatSync, readFileSync, closeSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { IdentityError, sessionHash } from "./identity-primitives.ts";

export function readIdentityKey(root: string): Buffer {
  const directory = resolve(root, ".secrets");
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error("UNSAFE_IDENTITY_KEY");
  const fd = openSync(resolve(directory, "identity-key"), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.size !== 65 || (file.mode & 0o077)
      || (process.getuid && file.uid !== process.getuid())) throw new Error("UNSAFE_IDENTITY_KEY");
    const value = readFileSync(fd, "utf8");
    if (!/^[a-f0-9]{64}\n$/.test(value)) throw new Error("INVALID_IDENTITY_KEY");
    return Buffer.from(value.trim(), "hex");
  } finally { closeSync(fd); }
}

// AES-GCM autentica também o usuário/finalidade: copiar ciphertext entre registros falha.
export function seal(key: Buffer, context: string, value: string): string {
  if (key.length !== 32) throw new Error("INVALID_IDENTITY_KEY");
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("jeriflow:v1:" + context));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return "v1." + Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
export function unseal(key: Buffer, context: string, value: string): string {
  if (!/^v1\.[A-Za-z0-9_-]{38,16384}$/.test(value)) throw new Error("INVALID_CIPHERTEXT");
  const packed = Buffer.from(value.slice(3), "base64url");
  if (packed.toString("base64url") !== value.slice(3)) throw new Error("INVALID_CIPHERTEXT");
  const cipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
  cipher.setAAD(Buffer.from("jeriflow:v1:" + context)); cipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([cipher.update(packed.subarray(28)), cipher.final()]).toString("utf8");
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(value: Buffer): string {
  let bits = 0, buffer = 0, result = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += alphabet[(buffer >>> bits) & 31]; }
  }
  if (bits) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}
export function decodeBase32(value: string): Buffer {
  if (!/^[A-Z2-7]{32}$/.test(value)) throw new Error("INVALID_TOTP_SECRET");
  let bits = 0, buffer = 0; const bytes = [];
  for (const char of value) {
    buffer = (buffer << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}
// RFC 6238 / HOTP: SHA-1, 30 segundos; SHA-1 aqui é HMAC, não hash de senha.
export function totp(secret: Buffer, step: number, digits: 6 | 8 = 6): string {
  if (!Number.isSafeInteger(step) || step < 0) throw new Error("INVALID_TOTP_STEP");
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(counter).digest(), offset = h[19] & 15;
  return ((h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, "0");
}
export function matchTotp(secret: string, code: unknown, now: number, lastStep = -1): number | undefined {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return undefined;
  const bytes = decodeBase32(secret), current = Math.floor(now / 30_000);
  let matched: number | undefined;
  for (const step of [current - 1, current, current + 1]) {
    if (step >= 0 && timingSafeEqual(Buffer.from(totp(bytes, step)), Buffer.from(code)) && step > lastStep) matched = step;
  }
  return matched;
}
export function actionHash(value: unknown): string {
  try { return sessionHash(value); } catch { throw new IdentityError(400, "INVALID_OR_EXPIRED_TOKEN"); }
}
