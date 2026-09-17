import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { runCommand } from "../scripts/native-process.mjs";

const options = { quiet: true, timeout: 5_000, killGraceMs: 50 };

test("comando preserva saída binária, stdin e argumentos sem executar shell", async () => {
  const result = await runCommand(process.execPath, ["-e", "process.stdin.pipe(process.stdout)", "$(false)"], { ...options, input: Buffer.from([0, 255, 10, 128]) });
  assert.deepEqual(result, Buffer.from([0, 255, 10, 128]));
  assert.equal((await runCommand(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "$(false)"], options)).toString(), "$(false)");
});

test("falhas e excesso de saída não viram sucesso ou truncamento silencioso", async () => {
  await assert.rejects(runCommand(process.execPath, ["-e", "console.error('diagnóstico de teste'); process.exit(7)"], options), error => error.exitCode === 7 && error.stderrTail.includes("diagnóstico de teste"));
  await assert.rejects(runCommand("/jeriflow-comando-inexistente", [], options), { code: "ENOENT" });
  await assert.rejects(runCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], { ...options, maxOutputBytes: 100 }), { code: "OUTPUT_LIMIT" });
});

for (const parentExits of [false, true]) {
  test(`timeout encerra filho resistente e pipes herdados, pai ${parentExits ? "já encerrado" : "ativo"}`, { timeout: 8_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "jeriflow-process-test-"));
    const pidFile = join(dir, "pid");
    let descendant;
    try {
      const childCode = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
      const parentCode = `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'}); writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); ${parentExits ? "process.exit(0)" : "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"};`;
      const started = Date.now();
      await assert.rejects(runCommand(process.execPath, ["-e", parentCode], { ...options, timeout: 600 }), { code: "ETIMEDOUT" });
      assert(Date.now() - started < 3_000, "Timeout aguardou indefinidamente pelos pipes");
      descendant = Number(readFileSync(pidFile, "utf8"));
      // Em Linux, um processo morto pode existir como zumbi até ser recolhido.
      let alive = true;
      for (let attempt = 0; attempt < 30 && alive; attempt++) {
        try {
          process.kill(descendant, 0);
          if (process.platform === "linux" && /\) Z /.test(readFileSync(`/proc/${descendant}/stat`, "utf8"))) alive = false;
        } catch (error) { if (["ESRCH", "ENOENT"].includes(error.code)) alive = false; else throw error; }
        if (alive) await pause(20);
      }
      assert.equal(alive, false, "Descendente continuou consumindo recursos");
    } finally {
      if (!descendant && existsSync(pidFile)) descendant = Number(readFileSync(pidFile, "utf8"));
      if (descendant) { try { process.kill(descendant, "SIGKILL"); } catch {} }
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("cancelamento interrompe o comando e recusa iniciar outro após abortar", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("cancelamento de teste")), 200);
  try {
    await assert.rejects(runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { ...options, signal: controller.signal }), { code: "ABORT_ERR" });
    await assert.rejects(runCommand(process.execPath, ["-e", "process.exit(0)"], { ...options, signal: controller.signal }), /cancelamento de teste/);
  } finally { clearTimeout(timer); }
});
