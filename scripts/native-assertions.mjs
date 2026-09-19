import assert from "node:assert/strict";

export function normalizeText(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function assertAppScreen(text, expectedName) {
  const actual = normalizeText(text);
  // A marca e o aviso também aparecem em telas de erro. Em uma instalação
  // limpa, só a entrada de autenticação confirma que o cofre foi consultado.
  for (const failure of ["Conexão indisponível", "Não foi possível acessar o armazenamento protegido"]) {
    if (actual.includes(normalizeText(failure))) {
      throw Object.assign(new Error(`Abertura do app falhou: ${failure}`), { fatal: true });
    }
  }
  for (const expected of [expectedName, "Ambiente de desenvolvimento", "Não use dados reais", "Bem-vindo de volta", "Email", "Senha (15 a 128 caracteres)", "Entrar", "Esqueci minha senha"]) {
    assert(actual.includes(normalizeText(expected)), `Tela não confirma: ${expected}`);
  }
}

export function assertAndroidManifest(manifest, config) {
  assert(manifest.includes(`package="${config.package}"`), "APK com identidade diferente");
  const application = manifest.match(/<application\b[^>]*>/s)?.[0];
  assert(application, "Manifesto sem application");
  assert(/android:allowBackup="false"/.test(application), "Backup precisa estar desativado");
  assert(!/android:debuggable="true"/.test(application), "APK de teste deve usar build Release");
  for (const permission of config.blockedPermissions) {
    assert(!manifest.includes(`android:name="${permission}"`), `Permissão indevida no APK: ${permission}`);
  }
}

export function selectIPhone(devices) {
  for (const runtime of Object.keys(devices).filter(key => key.includes(".iOS-")).sort().reverse()) {
    const device = devices[runtime].find(item => item.isAvailable && item.name.startsWith("iPhone"));
    if (device) return { ...device, runtime };
  }
  throw new Error("Nenhum simulador iPhone disponível; não substituir execução por compilação");
}
