import assert from "node:assert/strict";

export function createAndroidReadiness({ stableMs = 30_000, minimumSamples = 3 } = {}) {
  let since, processId, samples = 0;
  const reset = () => { since = undefined; processId = undefined; samples = 0; };
  return {
    reset,
    observe(pid, now = performance.now()) {
      if (!/^\d+$/.test(pid)) reset();
      assert(/^\d+$/.test(pid), "System UI precisa ter um único processo vivo");
      if (pid !== processId || (since !== undefined && now < since)) reset();
      processId = pid;
      since ??= now;
      samples++;
      return { ready: samples >= minimumSamples && now - since >= stableMs, stableMs: now - since, samples, systemUiPid: pid };
    },
  };
}

export function createAndroidHierarchyReader(adb) {
  let sequence = 0;
  return async () => {
    // uiautomator pode retornar código zero sem produzir XML. Um nome exclusivo
    // impede tanto leitura obsoleta quanto escrita tardia de uma captura anterior.
    const path = `/sdcard/jeriflow-screen-${++sequence}.xml`;
    const result = await adb(["shell", "uiautomator", "dump", path]);
    assert(!/ERROR:/i.test(result), `Falha ao ler a tela Android: ${result}`);
    const xml = await adb(["shell", "cat", path]);
    assert(/<hierarchy\b/.test(xml), "Captura Android não contém hierarquia");
    await adb(["shell", "rm", "-f", path]);
    return xml;
  };
}

export function assertNoSystemUiAnr(windows) {
  if (/Application Not Responding: com\.android\.systemui\b/.test(windows)) {
    throw Object.assign(new Error("System UI travou antes de instalar o app"), { fatal: true, systemUiBootFailure: true });
  }
}

export function assertAndroidHome(xml) {
  if (/System UI (?:isn(?:'|&apos;)t responding|is not responding)/i.test(xml)) {
    throw Object.assign(new Error("System UI travou antes de instalar o app"), { fatal: true, systemUiBootFailure: true });
  }
  assert(!/isn(?:'|&apos;)t responding|keeps stopping|is not responding/i.test(xml), "Android exibe um erro na preparação");
  assert(/package="com\.(?:android\.launcher3|google\.android\.apps\.nexuslauncher)"/.test(xml), "A tela inicial do Android ainda não está pronta");
}

// Recuperação limitada à inicialização do dispositivo, antes de instalar o app.
// Falhas de JeriFlow nunca passam por esta recuperação.
export async function prepareAndroidHome({ waitForHome, reboot, recordRecovery }) {
  try { await waitForHome(); }
  catch (error) {
    if (!error.systemUiBootFailure) throw error;
    await recordRecovery(error);
    await reboot();
    await waitForHome(); // Uma única reinicialização; a segunda falha é definitiva.
  }
}
