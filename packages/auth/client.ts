import { authMethods, canonicalToken } from "../contracts/src/identity.ts";

export class AuthFailure extends Error {
  code: string; status: number;
  constructor(code: string, status = 0) { super(code); this.code = code; this.status = status; }
}
export type Transport = { request(path: string, body?: object): Promise<Record<string, unknown>>; clear(): Promise<void> };
export type Vault = { get(): Promise<string | null>; set(value: string): Promise<void>; remove(): Promise<void> };
export const errorMessage = (error: unknown): string => {
  const code = error instanceof AuthFailure ? error.code : "UNKNOWN";
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: "Email ou senha incorretos.", INVALID_PASSWORD: "Use uma senha de 15 a 128 caracteres.",
    PASSWORD_MISMATCH: "As senhas não são iguais. Confira a confirmação.",
    INVALID_INPUT: "Confira os campos e tente novamente.", INVALID_FACTOR: "Código inválido, vencido ou já utilizado. Confira e tente novamente.",
    INVALID_OR_EXPIRED_TOKEN: "Este código venceu ou já foi usado. Solicite outro.", TOO_MANY_ATTEMPTS: "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.",
    UNAUTHORIZED: "Sua sessão terminou. Entre novamente.", REAUTHENTICATION_REQUIRED: "Entre novamente para confirmar sua identidade.",
    MFA_REQUIRED: "Confirme a proteção em duas etapas para continuar.", EMAIL_VERIFICATION_REQUIRED: "Confirme seu email para continuar.",
    FORBIDDEN: "Esta conta não tem permissão para acessar esta área.",
    INVALID_PUBLIC_PROFILE: "O cadastro público permite apenas Cidadão ou Turista.",
    MEMBERSHIP_SUSPENDED: "Este vínculo foi suspenso. Solicite a revisão ao responsável pelo município.",
    NOT_FOUND: "Conta ou município não encontrado ou indisponível. Atualize a lista.",
    CONFLICT: "Os dados já existem ou foram alterados. Atualize a lista antes de tentar novamente.",
    MUNICIPALITY_UNAVAILABLE: "Município indisponível. Atualize a lista.", MUNICIPALITY_CONFLICT: "Já existe um município com esse identificador.",
    ACCOUNT_EXISTS_USE_MANAGEMENT: "Esta conta já existe. Localize-a na lista para revisar seus vínculos.",
    ACCOUNT_NOT_FOUND: "Conta não encontrada. Atualize a lista.", STALE_REVISION: "Esta conta foi alterada por outra operação. Atualize e confira os vínculos antes de salvar.",
    PROTECTED_ACCOUNT: "Contas Mestre não podem ser alteradas nesta área.",
    NOT_CONFIGURED: "Servidor de teste ainda não configurado. Peça ao responsável para preparar a conexão.",
    STORAGE_UNAVAILABLE: "Não foi possível acessar o armazenamento protegido. Feche e abra o app; não use dados reais.",
    NETWORK: "Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.",
    AUTH_BUSY: "O servidor está ocupado. Aguarde um momento e tente novamente.",
  };
  return messages[code] ?? "Não foi possível concluir agora. Tente novamente em instantes.";
};
export function apiBase(value: string | undefined, localDevelopment = false): string {
  if (!value) throw new AuthFailure("NOT_CONFIGURED");
  let url: URL; try { url = new URL(value); } catch { throw new AuthFailure("NOT_CONFIGURED"); }
  const local = localDevelopment && url.protocol === "http:" && url.hostname === "127.0.0.1";
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash
    || !["", "/"].includes(url.pathname)) throw new AuthFailure("NOT_CONFIGURED");
  return url.origin;
}
export async function jsonRequest(url: string, method: string, body?: object, headers: Record<string,string> = {}): Promise<Record<string, unknown>> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { method, headers: { Accept: "application/json", ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: "no-store", redirect: "error" });
    let value: Record<string, unknown>;
    try { value = await response.json(); } catch { throw new AuthFailure("INVALID_RESPONSE"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthFailure("INVALID_RESPONSE");
    if (!response.ok) throw new AuthFailure(typeof value.error === "string" ? value.error : "UNAVAILABLE", response.status);
    return value;
  } catch (error) { if (error instanceof AuthFailure) throw error; throw new AuthFailure("NETWORK"); }
  finally { clearTimeout(timer); }
}
// O token vive somente nesta closure e no Keychain/Keystore do adapter nativo.
export function bearerTransport(base: () => string, vault: Vault): Transport {
  let token: string | null | undefined;
  async function clear() {
    token = null;
    try { await vault.remove(); } catch { throw new AuthFailure("STORAGE_UNAVAILABLE"); }
  }
  async function load() {
    if (token !== undefined) return token;
    try { token = await vault.get(); } catch { throw new AuthFailure("STORAGE_UNAVAILABLE"); }
    if (token !== null && !canonicalToken(token)) await clear();
    return token;
  }
  return { clear, async request(path, body) {
    const method = path.startsWith("/access?") ? "GET" : Object.hasOwn(authMethods, path) ? authMethods[path] : undefined;
    if (!method) throw new AuthFailure("INVALID_INPUT");
    const current = await load();
    if (path === "/auth/me" && !current) throw new AuthFailure("UNAUTHORIZED",401);
    const origin = base();
    try {
      const result = await jsonRequest(origin + "/api/v1" + path, method, body, current ? { Authorization: "Bearer " + current } : {});
      if (Object.hasOwn(result, "accessToken")) {
        if (!canonicalToken(result.accessToken)) throw new AuthFailure("INVALID_RESPONSE");
        const next = result.accessToken;
        try { await vault.set(next); token = next; }
        catch {
          await jsonRequest(origin + "/api/v1/auth/logout", "POST", {}, { Authorization: "Bearer " + next }).catch(() => {});
          await clear(); throw new AuthFailure("STORAGE_UNAVAILABLE");
        }
        delete result.accessToken;
      }
      if (["/auth/logout", "/auth/logout-all", "/auth/email/confirm", "/auth/password/reset", "/auth/registration/complete"].includes(path)) await clear();
      return result;
    } catch (error) {
      if (error instanceof AuthFailure && ["UNAUTHORIZED", "REAUTHENTICATION_REQUIRED"].includes(error.code)) await clear();
      throw error;
    }
  } };
}
export function cookieTransport(): Transport {
  return { clear: async () => {}, request: (path, body) => {
    const method = Object.hasOwn(authMethods, path) ? authMethods[path] : undefined;
    if (!method) return Promise.reject(new AuthFailure("INVALID_INPUT"));
    return jsonRequest("/api/identity" + path, method, body, { "X-JeriFlow-Request": "1" });
  } };
}
