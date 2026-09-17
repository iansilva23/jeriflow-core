import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { mobileApps } from "../packages/contracts/src/catalog.ts";
import { assertAppScreen, assertAndroidManifest, selectIPhone } from "./native-assertions.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.argv[2];
assert(["android", "ios"].includes(platform), "Plataforma esperada: android ou ios");
assert(process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_TEMP, "Este script usa apenas runners temporários do GitHub");
assert(process.platform === (platform === "ios" ? "darwin" : "linux"), "Sistema incompatível");
const output = join(root, "artifacts/native", platform);
mkdirSync(output, { recursive: true });
assert(!existsSync(join(output, "report.json")), "Recusando reutilizar evidência de outra execução");
const work = mkdtempSync(join(process.env.RUNNER_TEMP, "jeriflow-native-"));
const env = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", NODE_ENV: "production" };
const templateVersion = "57.0.24";
const templateIntegrity = "sha512-lEuzQiL+vWbRuqLx0DvQD7qvhv36TWQ1yfHDYKuodbjz+jFWm7/IzAMmrCGMcFNqoihbgk2YvMCQzAJNuDzuAA==";
const hash = (path, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(readFileSync(path)).digest(encoding);
const report = {
  schemaVersion: 1, scope: "native-technical-foundation", platform,
  status: "running", startedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
  node: process.version, hostArchitecture: process.arch, runnerImage: process.env.ImageVersion,
  lockfileSha256: hash(join(root, "package-lock.json")),
  template: { version: templateVersion, integrity: templateIntegrity },
  limitations: ["Telas de desenvolvimento, sem funções operacionais", "Somente dispositivos virtuais", "Sem homologação física ou publicação nas lojas", "Sem assinatura de produção; Android usa chave pública de desenvolvimento; iOS usa simulador"],
  apps: mobileApps.map(app => ({ ...app, status: "pending", launches: [] })),
};
const save = () => writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
save();

async function run(command, args = [], options = {}) {
  const { cwd = root, timeout = 180_000, quiet = false, input } = options;
  console.log(`> ${command} ${args.join(" ")}`);
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"], timeout, killSignal: "SIGKILL" });
    const stdout = [], stderr = [];
    let bytes = 0;
    child.stdout.on("data", data => {
      bytes += data.length;
      if (bytes < 16 * 1024 * 1024) stdout.push(data);
      if (!quiet) process.stdout.write(data);
    });
    child.stderr.on("data", data => {
      stderr.push(data);
      if (stderr.length > 100) stderr.shift();
      if (!quiet) process.stderr.write(data);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolveRun(Buffer.concat(stdout));
      else reject(new Error(`${command} falhou (${code ?? signal}): ${Buffer.concat(stderr).toString().slice(-8000)}\n${Buffer.concat(stdout).toString().slice(-8000)}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
async function eventually(check, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try { return await check(); } catch (error) { last = error; }
    await pause(2_000);
  } while (Date.now() < deadline);
  throw last ?? new Error("Prazo esgotado");
}
const asText = async (command, args, options = {}) => (await run(command, args, options)).toString().trim();
const configs = new Map(mobileApps.map(app => [app.id, JSON.parse(readFileSync(join(root, "apps", app.id, "app.json"))).expo]));
let cleanup = async () => {};

async function prebuild(app, template) {
  const directory = join(root, "apps", app.id);
  const before = hash(join(directory, "package.json"));
  await run(process.execPath, [join(root, "node_modules/expo/bin/cli"), "prebuild", directory,
    "--platform", platform, "--no-install", "--template", template, "--skip-dependency-update", "react,react-native"]);
  assert.equal(hash(join(directory, "package.json")), before, "Prebuild alterou dependências");
  assert.equal(hash(join(root, "package-lock.json")), report.lockfileSha256, "Prebuild alterou lockfile");
  return directory;
}

async function android(template) {
  const sdk = env.ANDROID_HOME;
  assert(sdk && env.JAVA_HOME_17_X64, "Android SDK e Java 17 necessários");
  env.JAVA_HOME = env.JAVA_HOME_17_X64;
  env.PATH = `${env.JAVA_HOME}/bin:${env.PATH}`;
  const sdkTool = name => join(sdk, "cmdline-tools/latest/bin", name);
  const adbPath = join(sdk, "platform-tools/adb");
  const adb = (args, opts = {}) => asText(adbPath, ["-s", "emulator-5554", ...args], { quiet: true, timeout: 30_000, ...opts });
  const image = "system-images;android-36;google_apis;x86_64";
  report.tools = { java: await asText("java", ["-version"]), sdk, systemImage: image };
  // As licenças já precisam estar aceitas no runner. Não executar --licenses.
  await run(sdkTool("sdkmanager"), ["platforms;android-36", "build-tools;36.0.0", "ndk;27.1.12297006", "cmake;3.30.5", "emulator", image], { timeout: 600_000 });
  for (const app of report.apps) {
    app.status = "building"; save();
    const dir = await prebuild(app, template);
    await run("./gradlew", [":app:assembleRelease", "--no-daemon", "--max-workers=2", "-PreactNativeArchitectures=arm64-v8a,x86_64", "-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1g"], { cwd: join(dir, "android"), timeout: 900_000 });
    const apk = join(dir, "android/app/build/outputs/apk/release/app-release.apk");
    const manifest = await asText(sdkTool("apkanalyzer"), ["manifest", "print", apk], { quiet: true });
    assertAndroidManifest(manifest, configs.get(app.id).android);
    const entries = await asText("unzip", ["-Z1", apk], { quiet: true });
    assert(entries.includes("assets/index.android.bundle"), "APK não contém JavaScript incorporado");
    for (const arch of ["arm64-v8a", "x86_64"]) assert(entries.includes(`lib/${arch}/libreactnative.so`), `ABI ausente: ${arch}`);
    app.build = { configuration: "Release", architectures: ["arm64-v8a", "x86_64"], sha256: hash(apk), embeddedJavaScript: true, manifestChecked: true };
    app.packageIdentifier = configs.get(app.id).android.package;
    app.binary = apk;
    app.status = "compiled"; save();
  }
  try { accessSync("/dev/kvm", constants.R_OK | constants.W_OK); }
  catch { await run("sudo", ["setfacl", "-m", `u:${process.getuid()}:rw`, "/dev/kvm"]); }
  const avd = "jeriflow-native-ci";
  await run(sdkTool("avdmanager"), ["create", "avd", "--name", avd, "--package", image], { input: "no\n" });
  const emulator = spawn(join(sdk, "emulator/emulator"), ["-avd", avd, "-port", "5554", "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot", "-gpu", "swiftshader_indirect", "-memory", "2048", "-no-metrics"], { env, stdio: "ignore" });
  let emulatorError;
  emulator.on("error", error => { emulatorError = error; });
  cleanup = async () => {
    await adb(["emu", "kill"]).catch(() => {});
    emulator.kill("SIGTERM");
  };
  await eventually(async () => {
    if (emulatorError) throw emulatorError;
    assert(emulator.exitCode === null, "Emulador encerrou durante inicialização");
    assert.equal(await adb(["shell", "getprop", "sys.boot_completed"]), "1");
  }, 240_000);
  await adb(["shell", "input", "keyevent", "82"]);
  report.device = { type: "emulator", androidVersion: await adb(["shell", "getprop", "ro.build.version.release"]), api: await adb(["shell", "getprop", "ro.build.version.sdk"]), abi: await adb(["shell", "getprop", "ro.product.cpu.abi"]) };
  for (const app of report.apps) {
    await adb(["install", "-r", app.binary], { timeout: 90_000 });
    app.installed = true;
    for (let launch = 1; launch <= 2; launch++) {
      await adb(["shell", "am", "force-stop", app.packageIdentifier]);
      const start = await adb(["shell", "am", "start", "-W", "-n", `${app.packageIdentifier}/.MainActivity`]);
      assert(!/Error:|Exception/i.test(start), start);
      const xml = await eventually(async () => {
        const pid = await adb(["shell", "pidof", app.packageIdentifier]);
        assert(/^\d+(?: \d+)*$/.test(pid), "Processo Android não está vivo");
        await adb(["shell", "uiautomator", "dump", "/sdcard/jeriflow-ui.xml"]);
        const screen = await adb(["shell", "cat", "/sdcard/jeriflow-ui.xml"]);
        assert(screen.includes(`package="${app.packageIdentifier}"`), "Outro app está em primeiro plano");
        assertAppScreen(screen, app.name);
        return screen;
      });
      const screenshot = `${app.id}-${launch}.png`;
      writeFileSync(join(output, screenshot), await run(adbPath, ["-s", "emulator-5554", "exec-out", "screencap", "-p"], { quiet: true, timeout: 30_000 }));
      writeFileSync(join(output, `${app.id}-${launch}.ui.json`), JSON.stringify({ hierarchy: xml }, null, 2) + "\n");
      app.launches.push({ launch, passed: true, screenshot, screenshotSha256: hash(join(output, screenshot)), launchOutput: start });
      save();
    }
    await adb(["shell", "am", "force-stop", app.packageIdentifier]);
    delete app.binary;
    app.status = "passed"; save();
  }
}

async function ios(template) {
  env.DEVELOPER_DIR = "/Applications/Xcode_26.6.app/Contents/Developer";
  assert(existsSync(env.DEVELOPER_DIR), "Xcode 26.6 ausente; atualizar somente após conferir compatibilidade");
  report.tools = { xcode: await asText("xcodebuild", ["-version"]), cocoapods: await asText("pod", ["--version"]), developerDirectory: env.DEVELOPER_DIR };
  const recognizer = join(work, "native-recognize");
  await run("xcrun", ["swiftc", "-O", join(root, "scripts/native-recognize.swift"), "-o", recognizer]);
  const sim = (args, opts = {}) => asText("xcrun", ["simctl", ...args], opts);
  const device = selectIPhone(JSON.parse(await sim(["list", "devices", "available", "-j"], { quiet: true })).devices);
  report.device = { type: "simulator", name: device.name, runtime: device.runtime, architecture: process.arch };
  for (const app of report.apps) {
    app.status = "building"; save();
    const dir = await prebuild(app, template);
    const nativeDir = join(dir, "ios");
    await run("pod", ["install"], { cwd: nativeDir, timeout: 600_000 });
    const workspace = readdirSync(nativeDir).find(name => name.endsWith(".xcworkspace"));
    assert(workspace, "Workspace Xcode ausente");
    const scheme = workspace.slice(0, -".xcworkspace".length);
    const derived = join(work, app.id);
    const arch = process.arch === "arm64" ? "arm64" : "x86_64";
    await run("xcodebuild", ["-quiet", "-workspace", join(nativeDir, workspace), "-scheme", scheme, "-configuration", "Release", "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", derived, "CODE_SIGNING_ALLOWED=NO", `ARCHS=${arch}`, "ONLY_ACTIVE_ARCH=YES", "build"], { cwd: nativeDir, timeout: 900_000 });
    const products = join(derived, "Build/Products/Release-iphonesimulator");
    const product = readdirSync(products).find(name => name.endsWith(".app"));
    assert(product, "Aplicativo iOS não foi gerado");
    const binary = join(products, product);
    const plist = join(binary, "Info.plist");
    const identifier = await asText("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist]);
    assert.equal(identifier, configs.get(app.id).ios.bundleIdentifier, "App iOS com identidade diferente");
    const executable = await asText("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", plist]);
    assert(existsSync(join(binary, "main.jsbundle")), "App iOS não contém JavaScript incorporado");
    app.build = { configuration: "Release", architecture: arch, executableSha256: hash(join(binary, executable)), bundleSha256: hash(join(binary, "main.jsbundle")), podfileLockSha256: hash(join(nativeDir, "Podfile.lock")), embeddedJavaScript: true, codeSigning: "disabled-simulator-only" };
    app.packageIdentifier = identifier;
    app.binary = binary;
    app.status = "compiled"; save();
  }
  if (device.state !== "Booted") {
    await sim(["boot", device.udid]);
    cleanup = async () => { await sim(["shutdown", device.udid]).catch(() => {}); };
  }
  await sim(["bootstatus", device.udid, "-b"], { timeout: 240_000 });
  await sim(["ui", device.udid, "appearance", "light"]);
  for (const app of report.apps) {
    await sim(["install", device.udid, app.binary]);
    app.installed = true;
    for (let launch = 1; launch <= 2; launch++) {
      const started = await sim(["launch", "--terminate-running-process", device.udid, app.packageIdentifier]);
      const pid = started.match(/:\s*(\d+)\s*$/)?.[1];
      assert(pid, "Simulador não informou PID do app");
      const screenshot = `${app.id}-${launch}.png`;
      const recognizedText = await eventually(async () => {
        const command = await asText("ps", ["-p", pid, "-o", "comm="], { quiet: true });
        assert(command.includes(".app/"), "Processo iOS não está vivo");
        await sim(["io", device.udid, "screenshot", join(output, screenshot)], { quiet: true });
        const lines = JSON.parse(await asText(recognizer, [join(output, screenshot)], { quiet: true }));
        assertAppScreen(lines.join(" "), app.name);
        return lines;
      }, 90_000);
      writeFileSync(join(output, `${app.id}-${launch}.ui.json`), JSON.stringify({ recognizedText }, null, 2) + "\n");
      app.launches.push({ launch, passed: true, screenshot, screenshotSha256: hash(join(output, screenshot)), pid: Number(pid) });
      save();
    }
    await sim(["terminate", device.udid, app.packageIdentifier]);
    delete app.binary;
    app.status = "passed"; save();
  }
}

try {
  await run("npm", ["exec", "--yes", "--ignore-scripts", "--package=npm@12.0.2", "--", "npm", "pack", `expo-template-bare-minimum@${templateVersion}`, "--ignore-scripts", "--pack-destination", work, "--json"]);
  const template = join(work, `expo-template-bare-minimum-${templateVersion}.tgz`);
  assert.equal(`sha512-${hash(template, "sha512", "base64")}`, templateIntegrity, "Template mudou; interrompendo antes de gerar projetos");
  await (platform === "android" ? android(template) : ios(template));
  assert(report.apps.length === 4 && report.apps.every(app => app.status === "passed" && app.launches.length === 2 && app.launches.every(launch => launch.passed)), "Evidência incompleta");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack ?? error).slice(-18000);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  await cleanup();
  for (const app of report.apps) delete app.binary;
  report.finishedAt = new Date().toISOString();
  save();
}
