import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { userInfo } from "node:os";
import sharp from "sharp";
import { CitizenAccountsV516 } from "../apps/api/src/citizen-accounts-v516.ts";
import { commandClamdV516 } from "../apps/api/src/clamav-daemon-live-v516.ts";
import { GuardTrafficReadServiceV516 } from "../apps/api/src/guard-traffic-read-http-v516.ts";
import { IdentityService } from "../apps/api/src/identity.ts";
import { readIdentityKey } from "../apps/api/src/identity-security.ts";
import { createApp } from "../apps/api/src/server.ts";
import { TrafficPhotoOwnershipV516 } from "../apps/api/src/traffic-photo-ownership-v516.ts";
import { TrafficPhotoPrivatePipelineV516 } from "../apps/api/src/traffic-photo-private-pipeline-v516.ts";
import { TrafficPhotoVerificationWorkerV516 } from "../apps/api/src/traffic-photo-verified-worker-v516.ts";
import { TrafficRegisteredFormServiceV516 } from "../apps/api/src/traffic-form-submit-v516.ts";
import { localIdentityConfiguration, migrateIdentity, ownerClient } from "./identity-database.mjs";
import { provisionIdentity } from "./identity-provision.mjs";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.JF_NATIVE_CIDADAO_TRAFFIC_SMOKE, "1");
assert.notEqual(process.env.NODE_ENV, "production");
assert(process.env.RUNNER_TEMP);
const root = fileURLToPath(new URL("..", import.meta.url));
const config = localIdentityConfiguration(root);
const directory = await mkdtemp(join(process.env.RUNNER_TEMP, "jf-citizen-"));
const owner = ownerClient(root);
const account = new CitizenAccountsV516(config.databaseUrl);
const ownership = new TrafficPhotoOwnershipV516(config.databaseUrl);
const read = new GuardTrafficReadServiceV516(config.databaseUrl);
const identity = new IdentityService(config, { encryptionKey: readIdentityKey(root) });
let daemon, worker, form, server;
async function close() {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  const ended = daemon?.exitCode === null && new Promise(resolve => daemon.once("exit", resolve));
  if (ended) {
    daemon.kill("SIGTERM");
    await Promise.race([ended, delay(2000)]);
    if (daemon.exitCode === null) daemon.kill("SIGKILL");
  }
  await Promise.allSettled([owner.end(), account.close(), ownership.close(), read.close(), identity.close(), worker?.close(), form?.close()]);
  await rm(directory, { recursive: true, force: true });
}
try {
  await migrateIdentity(root);
  await owner.connect();
  const id = randomUUID();
  const email = "cidadao-e2e-" + id + "@example.invalid";
  const password = randomBytes(24).toString("hex");
  const provision = await provisionIdentity(root, {
    email, password, displayName: "Cidadão Fictício",
    municipalities: [{ slug: "citizen-e2e-" + id, displayName: "Município Fictício", roles: ["cidadao"] }],
  });
  const municipalityId = provision.municipalities[0].id;
  await owner.query("UPDATE app.identity_users SET email_verified_at=clock_timestamp() WHERE id=$1", [provision.userId]);
  const citizenLogin = "citizen." + id;
  const citizenPassword = randomBytes(18).toString("hex");
  await account.signup({ municipalityId, name: "Cidadão Fictício", birthDate: "1993-10-10",
    phone: "(88) 90000-0000", address: "Rua Fictícia", login: citizenLogin, password: citizenPassword, confirmPassword: citizenPassword });
  const scannerPassword = randomBytes(24).toString("hex");
  await owner.query("CREATE ROLE jeriflow_citizen_scan LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '" + scannerPassword + "'");
  await owner.query("GRANT jeriflow_v516_scan_worker TO jeriflow_citizen_scan");
  const scannerUrl = new URL(config.databaseUrl);
  scannerUrl.username = "jeriflow_citizen_scan";
  scannerUrl.password = scannerPassword;
  for (const name of ["definitions", "clean", "quarantine"]) await mkdir(join(directory, name), { mode: 0o700 });
  const socket = join(directory, "scan.sock");
  const conf = join(directory, "clamd.conf");
  await writeFile(join(directory, "definitions", "synthetic.ndb"), "JeriFlow.Synthetic.Test.Marker:0:*:4a455249464c4f5753594e5448455449434d41524b4552\n");
  await writeFile(conf, [
    "DatabaseDirectory " + join(directory, "definitions"), "LocalSocket " + socket,
    "LocalSocketMode 600", "StreamMaxLength 16M", "ReadTimeout 20", "CommandReadTimeout 15",
    "MaxThreads 2", "MaxQueue 4", "User " + userInfo().username, "",
  ].join("\n"));
  daemon = spawn("/usr/sbin/clamd", ["--foreground", "--config-file=" + conf], { stdio: "ignore" });
  let launchError;
  daemon.on("error", error => { launchError = error; });
  let ready = false;
  for (let i = 0; i < 120 && !launchError && daemon.exitCode === null; i++) {
    if (await commandClamdV516(socket, "PING", 500).catch(() => "") === "PONG") { ready = true; break; }
    await delay(250);
  }
  assert(ready, "CLAMD_SYNTHETIC_UNAVAILABLE");
  const photoRoot = join(directory, "clean");
  worker = await TrafficPhotoVerificationWorkerV516.openPrivate({ photoRoot, clamdSocketPath: socket, workerDatabaseUrl: scannerUrl.href });
  const pipeline = await TrafficPhotoPrivatePipelineV516.openPrivate({ quarantineDirectory: join(directory, "quarantine"), cleanPhotoRoot: photoRoot, ownership, worker });
  form = new TrafficRegisteredFormServiceV516({ appDatabaseUrl: config.databaseUrl, pipeline, resolveSession: account.resolveSession.bind(account) });
  server = createApp(undefined, identity, undefined, read, undefined, undefined, undefined, form);
  await new Promise((resolve, reject) => server.once("error", reject).listen(3001, "127.0.0.1", resolve));
  await sharp({ create: { width: 580, height: 310, channels: 3, background: "#80d3ce" } })
    .png().toFile(join(process.env.RUNNER_TEMP, "jeriflow-traffic-fixture.png"));
  await writeFile(join(process.env.RUNNER_TEMP, "jeriflow-citizen-fixture.json"),
    JSON.stringify({ email, password, citizenLogin, citizenPassword, municipalityId }), { mode: 0o600, flag: "wx" });
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
} catch (error) {
  await close();
  console.error("CITIZEN_E2E_SETUP_FAILED", /^[A-Z0-9_]+$/.test(error?.code ?? "") ? error.code : "CHECK_SETUP");
  process.exitCode = 1;
}
