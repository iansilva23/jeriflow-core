import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statfsSync, writeFileSync } from "node:fs";
import { availableParallelism, freemem, totalmem } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { mobileApps } from "../packages/contracts/src/catalog.ts";
import { assertAppScreen, assertAndroidManifest, selectIPhone } from "./native-assertions.mjs";
import { runCommand, waitForNative } from "./native-process.mjs";
import { preserveApkAndCleanBuild } from "./native-storage.mjs";
import { loadNativeBuild, nativeBuildSource } from "./native-artifact.mjs";
import { assertAndroidHome, prepareAndroidHome } from "./native-emulator.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.argv[2];
assert(["android", "ios"].includes(platform), "Plataforma esperada: android ou ios");
const appId = process.argv[3] ?? "all";
const stage = process.argv[4] ?? (platform === "ios" ? "full" : "build");
assert(platform === "ios" ? stage === "full" : ["build", "smoke"].includes(stage), "Etapa nativa inválida");
assert(appId === "all" || mobileApps.some(app => app.id === appId), "App desconhecido");
assert(platform !== "android" || appId !== "all", "Android requer um app por runner");
assert(platform !== "ios" || appId === "all", "iOS verifica os quatro apps juntos");
const selectedApps = mobileApps.filter(app => appId === "all" || app.id === appId);
assert(process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_TEMP, "Este script usa apenas runners temporários do GitHub");
assert(process.platform === (platform === "ios" ? "darwin" : "linux"), "Sistema incompatível");
const output = join(root, "artifacts/native", platform, appId);
mkdirSync(output, { recursive: true });
assert(!existsSync(join(output, "report.json")), "Recusando reutilizar evidência de outra execução");
const work = mkdtempSync(join(process.env.RUNNER_TEMP, "jeriflow-native-"));
const env = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", NODE_ENV: "production" };
const templateVersion = "57.0.24";
const templateIntegrity = "sha512-lEuzQiL+vWbRuqLx0DvQD7qvhv36TWQ1yfHDYKuodbjz+jFWm7/IzAMmrCGMcFNqoihbgk2YvMCQzAJNuDzuAA==";
const hash = (path, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(readFileSync(path)).digest(encoding);
const report = {
  schemaVersion: 3, scope: "native-technical-foundation", platform, stage,
  selectedAppIds: selectedApps.map(app => app.id), catalogAppIds: mobileApps.map(app => app.id),
  status: "running", startedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
  node: process.version, hostArchitecture: process.arch, runnerImage: process.env.ImageVersion,
  lockfileSha256: hash(join(root, "package-lock.json")),
  template: { version: templateVersion, integrity: templateIntegrity },
  limitations: ["Telas de desenvolvimento, sem funções operacionais", "Somente dispositivos virtuais", "Sem homologação física ou publicação nas lojas", "Sem assinatura de produção; Android usa chave pública de desenvolvimento; iOS usa simulador"],
  apps: selectedApps.map(app => ({ ...app, status: "pending", launches: [] })),
  commands: [], resourceSamples: [],
};
const save = () => {
  writeFileSync(join(output, "report.tmp"), JSON.stringify(report, null, 2) + "\n");
  renameSync(join(output, "report.tmp"), join(output, "report.json"));
};
const execution = new AbortController();
const interrupt = reason => {
  if (execution.signal.aborted) return;
  report.status = "interrupted";
  report.interruption = { at: new Date().toISOString(), reason };
  save();
  execution.abort(new Error(reason));
};
const signalHandlers = new Map(["SIGINT", "SIGTERM"].map(signal => [signal, () => interrupt(signal)]));
for (const [signal, handler] of signalHandlers) process.on(signal, handler);
const totalTimeoutMs = (platform === "ios" ? 45 : stage === "smoke" ? 10 : 28) * 60_000;
const executionTimer = setTimeout(() => interrupt(`Prazo total de ${totalTimeoutMs} ms esgotado`), totalTimeoutMs);
const sampleResources = () => {
  const disk = statfsSync(work);
  const sample = { at: new Date().toISOString(), freeMemoryBytes: freemem(), totalMemoryBytes: totalmem(), freeDiskBytes: disk.bavail * disk.bsize };
  for (const name of ["memory.current", "memory.max", "memory.events"]) {
    const path = join("/sys/fs/cgroup", name);
    if (existsSync(path)) sample[name] = readFileSync(path, "utf8").trim();
  }
  report.resourceSamples.push(sample);
  if (report.resourceSamples.length > 120) report.resourceSamples.shift();
  save();
  return sample;
};
report.cpuCount = availableParallelism();
report.totalTimeoutMs = totalTimeoutMs;
const heartbeat = setInterval(() => {
  const sample = sampleResources();
  console.log(`[native] ${report.activeApp ?? platform}: ${report.phase ?? "preparação"}; memória livre ${Math.round(sample.freeMemoryBytes / 1024 ** 2)} MiB; disco livre ${Math.round(sample.freeDiskBytes / 1024 ** 3)} GiB`);
}, 30_000);
heartbeat.unref();
const phase = (name, app) => {
  report.phase = name;
  if (app) { report.activeApp = app.id; app.phase = name; }
  sampleResources();
};
save();

async function run(command, args = [], options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  const commandReport = { command: basename(command), app: report.activeApp, phase: report.phase, startedAt: new Date().toISOString(), status: "running" };
  report.commands.push(commandReport); save();
  const started = Date.now();
  try {
    const result = await runCommand(command, args, { cwd: root, env, signal: execution.signal, ...options });
    commandReport.status = "passed";
    return result;
  } catch (error) {
    commandReport.status = "failed";
    commandReport.error = String(error.message);
    throw error;
  } finally {
    commandReport.durationMs = Date.now() - started;
    commandReport.finishedAt = new Date().toISOString();
    save();
  }
}
async function eventually(check, timeout = 60_000) {
  return await waitForNative(check, { timeout, signal: execution.signal });
}
const asText = async (command, args, options = {}) => (await run(command, args, options)).toString().trim();
const configs = new Map(mobileApps.map(app => [app.id, JSON.parse(readFileSync(join(root, "apps", app.id, "app.json"))).expo]));
let cleanup = async () => {};
let collectFailure = async () => {};

async function prebuild(app, template) {
  phase("prebuild", app);
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
  env.GRADLE_USER_HOME = join(work, "gradle");
  env.ANDROID_AVD_HOME = join(work, "avd");
  mkdirSync(env.ANDROID_AVD_HOME);
  const sdkTool = name => join(sdk, "cmdline-tools/latest/bin", name);
  const adbPath = join(sdk, "platform-tools/adb");
  const adb = (args, opts = {}) => asText(adbPath, ["-s", "emulator-5554", ...args], { quiet: true, timeout: 30_000, ...opts });
  const image = "system-images;android-36;google_apis;x86_64";
  phase("android-sdk");
  report.tools = { java: await asText("java", ["--version"]), sdk, systemImage: image };
  if (stage === "build") {
    // As licenças já precisam estar aceitas no runner. Não executar --licenses.
    await run(sdkTool("sdkmanager"), ["platforms;android-36", "build-tools;36.0.0", "ndk;27.1.12297006", "cmake;3.30.5"], { timeout: 600_000 });
    for (const app of report.apps) {
      app.status = "building"; save();
      const dir = await prebuild(app, template);
      phase("gradle-release", app);
      report.buildLimits = { gradleWorkers: 2, gradleHeapMiB: 2048, gradleMetaspaceMiB: 1024, parallelProjects: false, kotlinExecution: "in-process", commandTimeoutMs: 900_000 };
      await run("./gradlew", [":app:assembleRelease", "--no-daemon", "--no-parallel", "--max-workers=2", "--console=plain", "--stacktrace", "-Pkotlin.compiler.execution.strategy=in-process", "-PreactNativeArchitectures=arm64-v8a,x86_64", "-Dorg.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=1g"], { cwd: join(dir, "android"), timeout: 900_000, capture: false });
      phase("apk-inspection", app);
      const apk = join(dir, "android/app/build/outputs/apk/release/app-release.apk");
      const manifest = await asText(sdkTool("apkanalyzer"), ["manifest", "print", apk], { quiet: true });
      assertAndroidManifest(manifest, configs.get(app.id).android);
      const entries = await asText("unzip", ["-Z1", apk], { quiet: true });
      assert(entries.includes("assets/index.android.bundle"), "APK não contém JavaScript incorporado");
      for (const arch of ["arm64-v8a", "x86_64"]) assert(entries.includes(`lib/${arch}/libreactnative.so`), `ABI ausente: ${arch}`);
      app.build = { configuration: "Release", architectures: ["arm64-v8a", "x86_64"], sha256: hash(apk), embeddedJavaScript: true, manifestChecked: true };
      app.packageIdentifier = configs.get(app.id).android.package;
      phase("release-build-storage", app);
      const before = sampleResources().freeDiskBytes;
      app.binary = preserveApkAndCleanBuild({ work, projectRoot: root, appDirectory: dir, apk, sha256: app.build.sha256 });
      report.storageCleanup = { beforeFreeBytes: before, afterFreeBytes: sampleResources().freeDiskBytes, preservedApkSha256: hash(app.binary), removed: ["projeto Android gerado", "cache Gradle exclusivo desta execução", "dependências node_modules usadas somente na compilação"] };
      // NDK já não é necessário depois de gerar o APK neste runner descartável.
      await run(sdkTool("sdkmanager"), ["--uninstall", "ndk;27.1.12297006"], { timeout: 120_000 });
      report.storageCleanup.removed.push("NDK 27.1.12297006 do runner descartável");
      report.storageCleanup.afterFreeBytes = sampleResources().freeDiskBytes;
      assert.equal(hash(app.binary), app.build.sha256, "APK divergiu após liberar disco");
      app.status = "compiled"; save();
    }
    copyFileSync(report.apps[0].binary, join(output, "verified.apk"));
    assert.equal(hash(join(output, "verified.apk")), report.apps[0].build.sha256, "APK de transferência divergiu");
    return;
  }
  const app = report.apps[0];
  app.status = "verifying";
  phase("apk-transfer-check", app);
  const source = nativeBuildSource({ commit: report.commit, runId: report.runId }, { buildCommit: env.NATIVE_BUILD_COMMIT, buildRunId: env.NATIVE_BUILD_RUN_ID });
  if (source.reused) {
    // Somente o mecanismo de teste e a documentação podem mudar no diagnóstico.
    await run("git", ["diff", "--exit-code", source.commit, "HEAD", "--", ".", ":!scripts/native-*", ":!tests/**", ":!docs/**", ":!.github/**", ":!README.md", ":!COMECE_AQUI.md"], { quiet: true });
  }
  const build = loadNativeBuild(join(root, "artifacts/native-build", app.id), {
    commit: source.commit, runId: source.runId, appId: app.id,
    packageIdentifier: configs.get(app.id).android.package,
    lockfileSha256: report.lockfileSha256, templateIntegrity,
  });
  app.binary = build.apk; app.build = build.build; app.status = "compiled";
  app.packageIdentifier = configs.get(app.id).android.package;
  report.buildSource = { ...build.source, reused: source.reused, applicationSourceUnchanged: true };
  assertAndroidManifest(await asText(sdkTool("apkanalyzer"), ["manifest", "print", app.binary], { quiet: true }), configs.get(app.id).android);
  phase("emulator-sdk");
  await run(sdkTool("sdkmanager"), ["emulator", image], { timeout: 600_000 });
  phase("emulator-boot");
  assert(sampleResources().freeDiskBytes >= 6 * 1024 ** 3, "Disco insuficiente: reservar ao menos 6 GiB antes de iniciar o emulador");
  try { accessSync("/dev/kvm", constants.R_OK | constants.W_OK); }
  catch { await run("sudo", ["setfacl", "-m", `u:${process.getuid()}:rw`, "/dev/kvm"]); }
  const avd = "jeriflow-native-ci";
  await run(sdkTool("avdmanager"), ["create", "avd", "--name", avd, "--package", image, "--device", "pixel_2"], { input: "no\n" });
  report.emulator = { status: "starting", profile: "pixel_2", logTail: "", bootRecoveries: [] };
  const emulator = spawn(join(sdk, "emulator/emulator"), ["-avd", avd, "-port", "5554", "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot", "-gpu", "swiftshader", "-memory", "2048", "-no-metrics"], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let emulatorLog = Buffer.alloc(0);
  const retainEmulatorLog = data => { emulatorLog = Buffer.concat([emulatorLog, data]).subarray(-16_384); report.emulator.logTail = emulatorLog.toString(); };
  emulator.stdout.on("data", retainEmulatorLog);
  emulator.stderr.on("data", retainEmulatorLog);
  let emulatorError;
  emulator.on("error", error => { emulatorError = error; });
  emulator.on("exit", (code, signal) => { report.emulator.exitCode = code; report.emulator.exitSignal = signal; save(); });
  collectFailure = async () => {
    report.androidDiagnostics = {};
    const capture = async (name, args) => {
      try { report.androidDiagnostics[name] = (await adb(args, { signal: null, timeout: 10_000 })).slice(-16_384); }
      catch (error) { report.androidDiagnostics[name] = String(error.message); }
    };
    const screenshot = `${app.id}-failure.png`;
    try {
      writeFileSync(join(output, screenshot), await run(adbPath, ["-s", "emulator-5554", "exec-out", "screencap", "-p"], { quiet: true, signal: null, timeout: 10_000 }));
      report.androidDiagnostics.screenshot = screenshot;
      report.androidDiagnostics.screenshotSha256 = hash(join(output, screenshot));
    } catch (error) { report.androidDiagnostics.screenshotError = String(error.message); }
    await capture("windows", ["shell", "dumpsys", "window", "windows"]);
    await capture("activities", ["shell", "dumpsys", "activity", "activities"]);
    await capture("crashes", ["logcat", "-b", "crash", "-d", "-t", "100"]);
    await capture("appErrors", ["logcat", "-d", "-t", "150", "ReactNativeJS:E", "AndroidRuntime:E", "ActivityManager:E", "*:S"]);
  };
  cleanup = async () => {
    report.emulator.status = "stopping";
    await adb(["emu", "kill"], { signal: null, timeout: 5_000 }).catch(() => {});
    if (emulator.pid) { try { process.kill(-emulator.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
    emulator.stdout.destroy(); emulator.stderr.destroy();
    emulator.unref();
  };
  const waitForBoot = async (previousBootId) => await eventually(async () => {
    if (emulatorError) throw Object.assign(emulatorError, { fatal: true });
    if (emulator.exitCode !== null || emulator.signalCode !== null) throw Object.assign(new Error(`Emulador encerrou durante inicialização (${emulator.exitCode ?? emulator.signalCode}): ${report.emulator.logTail}`), { fatal: true });
    assert.equal(await adb(["shell", "getprop", "sys.boot_completed"]), "1");
    if (previousBootId) assert.notEqual(await adb(["shell", "cat", "/proc/sys/kernel/random/boot_id"]), previousBootId, "Reinicialização ainda não começou");
  }, 240_000);
  await waitForBoot();
  report.emulator.status = "booted";
  phase("emulator-home-ready", app);
  await prepareAndroidHome({
    waitForHome: async () => {
      await adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
      await adb(["shell", "wm", "dismiss-keyguard"]);
      await adb(["shell", "input", "keyevent", "KEYCODE_HOME"]);
      let readySince;
      await eventually(async () => {
        await adb(["shell", "uiautomator", "dump", "/sdcard/jeriflow-home.xml"]);
        const xml = await adb(["shell", "cat", "/sdcard/jeriflow-home.xml"]);
        writeFileSync(join(output, `android-home-${report.emulator.bootRecoveries.length}.ui.json`), JSON.stringify({ hierarchy: xml }, null, 2) + "\n");
        try { assertAndroidHome(xml); } catch (error) { readySince = undefined; throw error; }
        readySince ??= Date.now();
        assert(Date.now() - readySince >= 5_000, "Aguardando estabilidade da tela inicial");
      }, 90_000);
      report.emulator.homeReady = true; save();
    },
    recordRecovery: async error => {
      const screenshot = "android-boot-system-ui-failure.png";
      writeFileSync(join(output, screenshot), await run(adbPath, ["-s", "emulator-5554", "exec-out", "screencap", "-p"], { quiet: true, timeout: 10_000 }));
      report.emulator.bootRecoveries.push({ reason: error.message, at: new Date().toISOString(), screenshot, screenshotSha256: hash(join(output, screenshot)), beforeAppInstall: true });
      save();
    },
    reboot: async () => {
      const previousBootId = await adb(["shell", "cat", "/proc/sys/kernel/random/boot_id"]);
      await adb(["reboot"]);
      await waitForBoot(previousBootId);
    },
  });
  report.device = { type: "emulator", androidVersion: await adb(["shell", "getprop", "ro.build.version.release"]), api: await adb(["shell", "getprop", "ro.build.version.sdk"]), abi: await adb(["shell", "getprop", "ro.product.cpu.abi"]) };
  for (const app of report.apps) {
    phase("install", app);
    await adb(["install", "-r", app.binary], { timeout: 90_000 });
    app.installed = true;
    for (let launch = 1; launch <= 2; launch++) {
      phase(`launch-${launch}`, app);
      await adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
      await adb(["shell", "wm", "dismiss-keyguard"]);
      await adb(["shell", "am", "force-stop", app.packageIdentifier]);
      const start = await adb(["shell", "am", "start", "-W", "-n", `${app.packageIdentifier}/.MainActivity`]);
      app.lastLaunchOutput = start; save();
      assert(!/Error:|Exception/i.test(start), start);
      const xml = await eventually(async () => {
        const pid = await adb(["shell", "pidof", app.packageIdentifier]);
        assert(/^\d+(?: \d+)*$/.test(pid), "Processo Android não está vivo");
        await adb(["shell", "uiautomator", "dump", "/sdcard/jeriflow-ui.xml"]);
        const screen = await adb(["shell", "cat", "/sdcard/jeriflow-ui.xml"]);
        writeFileSync(join(output, `${app.id}-${launch}.ui.json`), JSON.stringify({ hierarchy: screen, passed: false }, null, 2) + "\n");
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
  phase("ios-tools");
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
    phase("pods", app);
    await run("pod", ["install"], { cwd: nativeDir, timeout: 600_000 });
    const workspace = readdirSync(nativeDir).find(name => name.endsWith(".xcworkspace"));
    assert(workspace, "Workspace Xcode ausente");
    const scheme = workspace.slice(0, -".xcworkspace".length);
    const derived = join(work, app.id);
    const arch = process.arch === "arm64" ? "arm64" : "x86_64";
    phase("xcode-release", app);
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
    cleanup = async () => { await sim(["shutdown", device.udid], { signal: null, timeout: 30_000 }).catch(() => {}); };
  }
  await sim(["bootstatus", device.udid, "-b"], { timeout: 240_000 });
  await sim(["ui", device.udid, "appearance", "light"]);
  for (const app of report.apps) {
    phase("install", app);
    await sim(["install", device.udid, app.binary]);
    app.installed = true;
    for (let launch = 1; launch <= 2; launch++) {
      phase(`launch-${launch}`, app);
      const started = await sim(["launch", "--terminate-running-process", device.udid, app.packageIdentifier]);
      const pid = started.match(/:\s*(\d+)\s*$/)?.[1];
      assert(pid, "Simulador não informou PID do app");
      await pause(1_000, undefined, { signal: execution.signal });
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
  if (stage === "smoke") {
    await android();
  } else {
    phase("template");
    await run("npm", ["exec", "--yes", "--ignore-scripts", "--package=npm@12.0.2", "--", "npm", "pack", `expo-template-bare-minimum@${templateVersion}`, "--ignore-scripts", "--pack-destination", work, "--json"]);
    const template = join(work, `expo-template-bare-minimum-${templateVersion}.tgz`);
    assert.equal(`sha512-${hash(template, "sha512", "base64")}`, templateIntegrity, "Template mudou; interrompendo antes de gerar projetos");
    await (platform === "android" ? android(template) : ios(template));
  }
  execution.signal.throwIfAborted();
  if (stage === "build") {
    assert(report.apps.length === 1 && report.apps[0].status === "compiled", "Compilação incompleta");
    report.status = "compiled";
  } else {
    assert(report.apps.length === selectedApps.length && report.apps.every(app => app.status === "passed" && app.launches.length === 2 && app.launches.every(launch => launch.passed)), "Evidência incompleta");
    report.status = "passed";
  }
} catch (error) {
  report.status = execution.signal.aborted ? "interrupted" : "failed";
  report.error = String(error.stack ?? error).slice(-18000);
  report.failure = { command: error.command, code: error.code, exitCode: error.exitCode, exitSignal: error.exitSignal, stdoutTail: error.stdoutTail, stderrTail: error.stderrTail };
  for (const app of report.apps) if (!["passed", "pending"].includes(app.status)) app.status = "failed";
  console.error(report.error);
  if (error.stderrTail || error.stdoutTail) console.error(error.stderrTail ?? "", error.stdoutTail ?? "");
  process.exitCode = 1;
  await collectFailure().catch(failure => { report.diagnosticError = String(failure); });
} finally {
  try { await cleanup(); }
  catch (error) { report.cleanupError = String(error); report.status = "failed"; process.exitCode = 1; }
  finally {
    clearTimeout(executionTimer); clearInterval(heartbeat);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    for (const app of report.apps) delete app.binary;
    report.finishedAt = new Date().toISOString();
    sampleResources();
  }
}
