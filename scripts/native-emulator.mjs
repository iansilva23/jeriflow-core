import assert from "node:assert/strict";

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
