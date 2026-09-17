import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// Runners POSIX: cada comando possui seu próprio grupo de processos. O timeout
// do spawn sozinho mata apenas o pai e pode esperar indefinidamente por pipes
// herdados pelos filhos. O prazo abaixo independe do evento "close".
export async function runCommand(command, args = [], options = {}) {
  const { cwd, env = process.env, timeout = 180_000, killGraceMs = 1_000,
    quiet = false, input, signal, capture = true, maxOutputBytes = 16 * 1024 * 1024 } = options;
  assert(process.platform !== "win32", "Verificação nativa requer um runner POSIX");
  assert(Number.isFinite(timeout) && timeout > 0, "Prazo do comando inválido");
  assert(Number.isFinite(killGraceMs) && killGraceMs >= 0, "Prazo de encerramento inválido");
  signal?.throwIfAborted();
  const startedAt = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    let stdoutBytes = 0, stdoutTail = Buffer.alloc(0), stderrTail = Buffer.alloc(0);
    let settled = false, stopping, graceTimer, exitCode, exitSignal;
    const tail = (previous, data) => Buffer.concat([previous, data]).subarray(-16_384);
    const killGroup = signalName => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signalName); }
      catch (error) { if (error.code !== "ESRCH") child.kill(signalName); }
    };
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(graceTimer);
      signal?.removeEventListener("abort", onAbort);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
      if (error) {
        error.command = command;
        error.durationMs = Date.now() - startedAt;
        error.exitCode = exitCode;
        error.exitSignal = exitSignal;
        error.stdoutTail = stdoutTail.toString();
        error.stderrTail = stderrTail.toString();
        reject(error);
      } else resolve(Buffer.concat(stdout));
    };
    const stop = error => {
      if (settled || stopping) return;
      stopping = error;
      killGroup("SIGTERM");
      // Mesmo que o pai feche os pipes antes, encerrar descendentes que ignoram
      // SIGTERM. Nunca sinalizar processos fora do grupo criado neste comando.
      graceTimer = setTimeout(() => { killGroup("SIGKILL"); finish(stopping); }, killGraceMs);
    };
    const onAbort = () => stop(Object.assign(new Error(`Comando interrompido: ${command}`, { cause: signal.reason }), { code: "ABORT_ERR" }));
    const deadlineTimer = setTimeout(() => stop(Object.assign(new Error(`Prazo de ${timeout} ms esgotado: ${command}`), { code: "ETIMEDOUT" })), timeout);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", data => {
      stdoutTail = tail(stdoutTail, data);
      if (capture) {
        stdoutBytes += data.length;
        if (stdoutBytes <= maxOutputBytes) stdout.push(data);
        else stop(Object.assign(new Error(`Saída excedeu o limite: ${command}`), { code: "OUTPUT_LIMIT" }));
      }
      if (!quiet) process.stdout.write(data);
    });
    child.stderr.on("data", data => {
      stderrTail = tail(stderrTail, data);
      if (!quiet) process.stderr.write(data);
    });
    child.on("error", error => { if (child.pid) stop(error); else finish(error); });
    child.on("exit", (code, signalName) => {
      exitCode = code; exitSignal = signalName;
      if (code !== 0 && !stopping) stop(new Error(`${command} falhou (${code ?? signalName})`));
    });
    child.on("close", (code, signalName) => {
      if (stopping) return;
      if (code === 0) finish();
      else stop(new Error(`${command} falhou (${code ?? signalName})`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
