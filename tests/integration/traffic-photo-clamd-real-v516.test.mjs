/**
 * Integração REAL de clamd via socket Unix, com assinatura LOCAL e INOFENSIVA.
 *
 * V5.16: cidadao-ai/index.html #trafficForm e
 * shared/jeriflow-audit-citizen.js evidence(): foto obrigatória, 8MiB,
 * imageFileToData(file,1200,.7). Sem modificar a UX.
 *
 * NÃO é homologação de bases de vírus oficiais/atualizadas. Não tocar VPS.
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import sharp from "sharp";
import { randomUUID, createHash } from "node:crypto";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TrafficCleanPhotoStoreV516 } from "../../apps/api/src/traffic-photo-clean-store-v516.ts";
import { scanStoredTrafficPhotoV516 } from "../../apps/api/src/traffic-photo-malware-v516.ts";
import { TrafficPhotoVerificationWorkerV516 } from "../../apps/api/src/traffic-photo-verified-worker-v516.ts";

const ownerDsn = process.env.JF_V516_TEST_OWNER_DSN;
const appDsn = process.env.JF_V516_TEST_APP_DSN;
const workerDsn = process.env.JF_V516_TEST_WORKER_DSN;
if (!ownerDsn || !appDsn || !workerDsn)
  throw new Error("EPHEMERAL_POSTGRES_REQUIRED");

const sha256 = b => createHash("sha256").update(b).digest("hex");
const md5 = b => createHash("md5").update(b).digest("hex");
const errorCode = code => e => e?.code === code;
const rawClamd = existsSync("/usr/sbin/clamd") ? "/usr/sbin/clamd" : "clamd";

async function ping(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let settled = false;
    const done = (err, ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve(ok);
    };
    socket.setTimeout(700);
    socket.on("timeout", () => done(new Error("CLAMD_PING_TIMEOUT")));
    socket.on("error", e => done(e));
    socket.on("connect", () => socket.write(Buffer.from("zPING\0")));
    socket.on("data", data => done(undefined, data.toString("utf8").includes("PONG\0")));
    socket.on("end", () => done(new Error("CLAMD_CLOSED_EARLY")));
  });
}

async function startRealClamd(root, infected) {
  const dbDir = join(root, "definitions");
  await mkdir(dbDir, { mode: 0o700 });
  const signatureName = "Win.Test.JeriFlow-Synthetic-WebP";
  await writeFile(join(dbDir, "test.hdb"),
    md5(infected) + ":" + infected.length + ":" + signatureName + "\n",
    { mode: 0o600 });
  const socketPath = join(root, "clamd.sock");
  const conf = join(root, "clamd.conf");
  const account = userInfo().username;
  if (!/^[a-z_][a-z0-9_-]*$/i.test(account)) throw new Error("UNSAFE_TEST_USERNAME");
  await writeFile(conf, [
    "DatabaseDirectory " + dbDir,
    "LocalSocket " + socketPath,
    "LocalSocketMode 600",
    "StreamMaxLength 16M",
    "ReadTimeout 20",
    "CommandReadTimeout 15",
    "MaxThreads 2",
    "MaxQueue 4",
    "User " + account,
    "LogTime yes",
    ""
  ].join("\n"), { mode: 0o600 });
  let diagnostics = "";
  const proc = spawn(rawClamd, ["--foreground", "--config-file=" + conf],
    { stdio: ["ignore", "pipe", "pipe"], shell: false });
  const capture = d => { diagnostics = (diagnostics + d.toString()).slice(-12000); };
  proc.stdout.on("data", capture);
  proc.stderr.on("data", capture);
  let startupError;
  proc.on("error", e => { startupError = e; });
  let running = false;
  for (let attempt = 0; attempt < 160; attempt++) {
    if (startupError || proc.exitCode !== null) break;
    try { if (await ping(socketPath)) { running = true; break; } }
    catch {}
    await delay(250);
  }
  if (!running) {
    proc.kill("SIGTERM");
    throw new Error("REAL_CLAMD_DID_NOT_START: " +
      String(startupError?.message ?? diagnostics).slice(-2800));
  }
  return { socketPath, proc, diagnostics: () => diagnostics };
}
async function stopClamd(proc) {
  if (!proc || proc.exitCode !== null) return;
  const exited = new Promise(resolve => proc.once("exit", resolve));
  proc.kill("SIGTERM");
  await Promise.race([exited, delay(2500)]);
  if (proc.exitCode === null) proc.kill("SIGKILL");
}

function normalized(bytes, meta) {
  return {
    bytes, sha256: sha256(bytes), originalSha256: sha256("original-synthetic-fixture"),
    byteLength: bytes.length, width: meta.width, height: meta.height,
    mime: "image/webp", maxWidthFromV516: 1200, qualityFromV516: 70,
    sourceMime: "image/png", imageDecoded: true, metadataRemoved: true,
    stored: false, malwareScanned: false, evidenceApproved: false,
    protocolCreated: false
  };
}

test("V5.16: daemon ClamAV VERDADEIRO + worker privado + PostgreSQL descartável",
  { timeout: 150_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), "jf516-real-clamd-"));
    const owner = new pg.Client({ connectionString: ownerDsn });
    const app = new pg.Client({ connectionString: appDsn });
    let daemon, worker;
    try {
      const safe = await sharp({
        create: { width: 64, height: 52, channels: 3, background: "#c0e1f9" }
      }).webp({ quality: 70 }).toBuffer();
      const flagged = await sharp({
        create: { width: 64, height: 52, channels: 3, background: "#ff64a0" }
      }).webp({ quality: 70 }).toBuffer();
      assert.notDeepEqual(safe, flagged);
      daemon = await startRealClamd(root, flagged);
      assert(await ping(daemon.socketPath), "clamd real precisa responder PING");

      const store = await TrafficCleanPhotoStoreV516.openPrivate(root);
      const mid = randomUUID();
      const safeMeta = await sharp(safe).metadata();
      const flaggedMeta = await sharp(flagged).metadata();
      const cleanTicket = await store.store(mid, normalized(safe, safeMeta));
      const flaggedTicket = await store.store(mid, normalized(flagged, flaggedMeta));

      await owner.connect();
      await owner.query("CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-jeriflow-test-only'");
      await owner.query("CREATE SCHEMA app");
      await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
      for (const name of [
        "001-identity.sql", "002-identity-security.sql",
        "003-account-management.sql", "004-citizen-v516.sql",
        "005-citizen-v516-traffic-protocol.sql",
        "006-citizen-v516-scanned-photo-worker.sql"
      ]) {
        await owner.query(readFileSync(
          new URL("../../infra/migrations/" + name, import.meta.url), "utf8"));
      }
      await owner.query("CREATE ROLE jeriflow_scan_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-scan-test-only'");
      await owner.query("GRANT jeriflow_v516_scan_worker TO jeriflow_scan_test");
      await owner.query("INSERT INTO app.municipalities(id,slug,display_name) VALUES($1,'real-clamd-synthetic','Cidade Fictícia')", [mid]);
      await app.connect();

      const count = async () => (await owner.query(
        "SELECT count(*)::int AS n FROM app.citizen_v516_verified_traffic_media")).rows[0].n;

      await t.test("clamd real responde ao protocolo PING em socket Unix privado", async () => {
        assert(await ping(daemon.socketPath));
      });
      await t.test("clamd real libera WebP limpo sem aprovar protocolo", async () => {
        const result = await scanStoredTrafficPhotoV516(store, cleanTicket, daemon.socketPath, 15000);
        assert.equal(result.malwareScanned, true);
        assert.equal(result.evidenceApproved, false);
        assert.equal(result.protocolCreated, false);
        assert.equal(result.publicUrl, null);
      });
      await t.test("assinatura de teste inofensiva detectada pelo daemon ClamAV REAL", async () => {
        await assert.rejects(
          scanStoredTrafficPhotoV516(store, flaggedTicket, daemon.socketPath, 15000),
          errorCode("MALWARE_DETECTED"));
        assert.equal(await count(), 0);
      });
      worker = await TrafficPhotoVerificationWorkerV516.openPrivate({
        photoRoot: root, clamdSocketPath: daemon.socketPath, workerDatabaseUrl: workerDsn
      });
      await t.test("worker registra foto limpa no gate SQL após passar pelo clamd REAL", async () => {
        const result = await worker.verifyAndRegister(cleanTicket);
        assert.equal(result.registeredForProtocol, true);
        assert.equal(result.evidenceApproved, false);
        assert.equal(result.protocolCreated, false);
        assert.equal(await count(), 1);
        const db = await owner.query(
          "SELECT municipality_id,photo_id,sha256,consumed_by FROM app.citizen_v516_verified_traffic_media");
        assert.equal(db.rows[0].municipality_id, mid);
        assert.equal(db.rows[0].photo_id, cleanTicket.photoId);
        assert.equal(db.rows[0].sha256, cleanTicket.sha256);
        assert.equal(db.rows[0].consumed_by, null);
      });
      await t.test("worker NÃO registra foto marcada pela assinatura real", async () => {
        await assert.rejects(worker.verifyAndRegister(flaggedTicket),
          errorCode("MALWARE_DETECTED"));
        assert.equal(await count(), 1);
      });
      await t.test("API HTTP não pode aprovar foto nem chamar função do worker", async () => {
        await assert.rejects(app.query(
          "SELECT app.citizen_v516_record_scanned_media($1,$2,$3)",
          [mid, flaggedTicket.photoId, flaggedTicket.sha256]), errorCode("42501"));
        assert.equal(await count(), 1);
      });
      await t.test("scan não emite protocolo de trânsito por conta própria", async () => {
        const result = await owner.query(
          "SELECT count(*)::int AS n FROM app.citizen_v516_traffic_protocols");
        assert.equal(result.rows[0].n, 0);
      });
    } finally {
      await worker?.close().catch(() => {});
      await app.end().catch(() => {});
      await owner.end().catch(() => {});
      await stopClamd(daemon?.proc);
      await rm(root, { recursive: true, force: true });
    }
  });
