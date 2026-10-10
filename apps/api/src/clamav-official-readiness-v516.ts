/**
 * Guard interno: database OFICIAL antes de usar ClamAV no JeriFlow.
 *
 * A V5.16 exige uma fotografia no formulário Trânsito; não define antivírus.
 * Fonte original: cidadao-ai/index.html #trafficForm, submitTrafficForm(),
 * shared/jeriflow-audit-citizen.js evidence().
 * ZIP SHA-256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 *
 * NÃO é prova de segurança completa nem endpoint. Nenhum arquivo do usuário é
 * alterado e nenhum resultado é usado para aprovar denúncia por si só.
 * A confiança na assinatura CVD/CLD vem de sigtool (biblioteca ClamAV), NÃO
 * apenas da extensão, horário do arquivo ou de uma flag do cliente.
 */
import { lstat } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const MAX_DATABASE_BYTES = 512 * 1024 * 1024;
const MAX_DAILY_AGE_MS = 72 * 60 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 60 * 60 * 1000;
const SIGNED_NAMES = ["main", "daily", "bytecode"] as const;

export type OfficialDatabaseKindV516 = (typeof SIGNED_NAMES)[number];
export type VerifiedDatabaseV516 = Readonly<{
  kind: OfficialDatabaseKindV516;
  source: "official-clamav-signed-cvd";
  buildTimestamp: string;
  verified: true;
}>;
export type OfficialSignatureReadinessV516 = Readonly<{
  ready: true;
  signaturesVerified: true;
  dailyWithin72Hours: true;
  checkedAt: string;
  databases: readonly VerifiedDatabaseV516[];
  evidenceApproved: false;
  protocolCreated: false;
}>;
export class ClamAVOfficialReadinessErrorV516 extends Error {
  readonly code:
    | "OFFICIAL_SIGNATURES_MISSING"
    | "OFFICIAL_SIGNATURES_UNVERIFIED"
    | "OFFICIAL_SIGNATURES_STALE"
    | "OFFICIAL_SIGNATURES_UNAVAILABLE"
    | "OFFICIAL_SIGNATURES_CHANGED";
  constructor(code: ClamAVOfficialReadinessErrorV516["code"]) {
    super(code);
    this.code = code;
  }
}
type VerifiedFile = Readonly<{
  path: string;
  size: number;
  ino: number | bigint;
  mtimeMs: number;
  dev: number | bigint;
}>;
async function secureStat(path: string): Promise<VerifiedFile> {
  let stat;
  try { stat = await lstat(path); }
  catch { throw new ClamAVOfficialReadinessErrorV516("OFFICIAL_SIGNATURES_MISSING"); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      stat.size <= 512 || stat.size > MAX_DATABASE_BYTES) {
    throw new ClamAVOfficialReadinessErrorV516("OFFICIAL_SIGNATURES_UNVERIFIED");
  }
  return { path, size: stat.size, ino: stat.ino, dev: stat.dev, mtimeMs: stat.mtimeMs };
}
async function findSignedFile(dir: string, kind: OfficialDatabaseKindV516): Promise<VerifiedFile> {
  // First choose a CVD. Incremental CLD files are deliberately rejected in
  // this phase unless sigtool itself confirms a valid digital signature.
  const candidates = [join(dir, kind + ".cvd"), join(dir, kind + ".cld")];
  for (const path of candidates) {
    try { return await secureStat(path); }
    catch (error) {
      if ((error as ClamAVOfficialReadinessErrorV516).code !== "OFFICIAL_SIGNATURES_MISSING")
        throw error;
    }
  }
  throw new ClamAVOfficialReadinessErrorV516("OFFICIAL_SIGNATURES_MISSING");
}
export function parseVerifiedSigtoolInfoV516(
  text: string, now = Date.now(), daily = false,
): string {
  if (typeof text !== "string" || text.length > 32_000 ||
      !/(?:^|\n)Verification OK\.?(?:\r?\n|$)/i.test(text)) {
    throw new ClamAVOfficialReadinessErrorV516("OFFICIAL_SIGNATURES_UNVERIFIED");
  }
  const match = text.match(/(?:^|\n)Build time:\s*([^\r\n]+)/i);
  if (!match) throw new ClamAVOfficialReadinessErrorV516("OFFICIAL_SIGNATURES_UNVERIFIED");
  const timestamp = Date.parse(match[1]);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now) ||
      timestamp > now + CLOCK_TOLERANCE_MS) {
    throw new ClamAVOfficialReadinessErrorV516("OFFICIAL_SIGNATURES_UNVERIFIED");
  }
  if (daily && now - timestamp > MAX_DAILY_AGE_MS) {
    throw new ClamAVOfficialReadinessErrorV516("OFFICIAL_SIGNATURES_STALE");
  }
  return new Date(timestamp).toISOString();
}

/**
 * Fail closed. This guard performs NO database download itself. Use FreshClam
 * outside the API, then verify each ClamAV-signed database with sigtool.
 *
 * 'now' is injectable ONLY to make pure unit tests deterministic; a trusted
 * production caller must call without this argument.
 */
export async function checkOfficialClamAVDatabasesV516(
  directory: string,
  now = Date.now(),
): Promise<OfficialSignatureReadinessV516> {
  if (!isAbsolute(directory) || directory.includes("\0") ||
      !Number.isFinite(now)) {
    throw new ClamAVOfficialReadinessErrorV516("OFFICIAL_SIGNATURES_UNAVAILABLE");
  }
  const dir = resolve(directory);
  const verified: VerifiedDatabaseV516[] = [];
  for (const kind of SIGNED_NAMES) {
    const before = await findSignedFile(dir, kind);
    let output: string;
    try {
      const result = await execFileAsync("/usr/bin/sigtool", ["--info", before.path],
        { timeout: 12_000, maxBuffer: 32_000, shell: false });
      output = result.stdout;
    } catch {
      throw new ClamAVOfficialReadinessErrorV516("OFFICIAL_SIGNATURES_UNAVAILABLE");
    }
    const buildTimestamp = parseVerifiedSigtoolInfoV516(output, now, kind === "daily");
    const after = await secureStat(before.path);
    if (before.ino !== after.ino || before.dev !== after.dev ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new ClamAVOfficialReadinessErrorV516("OFFICIAL_SIGNATURES_CHANGED");
    }
    verified.push(Object.freeze({
      kind,
      source: "official-clamav-signed-cvd" as const,
      buildTimestamp,
      verified: true as const,
    }));
  }
  return Object.freeze({
    ready: true, signaturesVerified: true, dailyWithin72Hours: true,
    checkedAt: new Date(now).toISOString(),
    databases: Object.freeze(verified),
    evidenceApproved: false, protocolCreated: false,
  });
}
