import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";

export class IdentityError extends Error {
  status: number;
  code: string;
  retryAfter?: number;
  constructor(status: number, code: string, retryAfter?: number) {
    super(code); this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}
export function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw new IdentityError(400, "INVALID_INPUT");
  return value as Record<string, unknown>;
}
export function emailAddress(value: unknown): string {
  if (typeof value !== "string") throw new IdentityError(400, "INVALID_INPUT");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)
    || email.startsWith(".") || email.includes("..") || email.includes(".@")) throw new IdentityError(400, "INVALID_INPUT");
  return email;
}
export function passwordValue(value: unknown): string {
  if (typeof value !== "string" || [...value].length < 15 || [...value].length > 128
    || Buffer.byteLength(value, "utf8") > 512) throw new IdentityError(400, "INVALID_PASSWORD");
  return value; // Sem truncar, remover espaços ou normalizar a senha.
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new IdentityError(400, "INVALID_INPUT");
  return value.toLowerCase();
}
export function displayName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(value))
    throw new IdentityError(400, "INVALID_INPUT");
  return value.trim();
}
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function sessionHash(token: unknown): string {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || Buffer.from(token, "base64url").toString("base64url") !== token) throw new IdentityError(401, "UNAUTHORIZED");
  return digest(token);
}
// Formato versionado e parâmetros fixos. Um registro adulterado não escolhe custo.
const prefix = "scrypt$v1$131072$8$1$";
const dummy = prefix + "0".repeat(32) + "$" + "0".repeat(64);
let hashing = 0;
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (hashing >= 2) throw new IdentityError(503, "AUTH_BUSY", 1);
  hashing++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32,
      { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 ** 2 }, (error, value) => error ? reject(error) : resolve(value)));
  } finally { hashing--; }
}
export async function hashPassword(password: unknown): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(passwordValue(password), salt);
  return prefix + salt.toString("hex") + "$" + hash.toString("hex");
}
export async function verifyPassword(password: unknown, encoded: string | undefined): Promise<boolean> {
  const valid = typeof encoded === "string" && /^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(encoded);
  const parts = (valid ? encoded! : dummy).split("$");
  const actual = await derive(passwordValue(password), Buffer.from(parts[5], "hex"));
  return timingSafeEqual(actual, Buffer.from(parts[6], "hex")) && valid;
}
