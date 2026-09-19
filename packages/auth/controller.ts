import { identityContext, type IdentityContext } from "../contracts/src/identity.ts";
import { AuthFailure, errorMessage, type Transport } from "./client.ts";

export type Mode = "loading" | "login" | "forgot" | "reset" | "verify" | "mfa" | "enroll" | "backup" | "home" | "unavailable" | "rotate";
export type AuthState = { mode: Mode; busy: boolean; context?: IdentityContext; error?: string; notice?: string; secret?: string; codes?: string[] };
export class AuthController {
  private transport: Transport;
  private state: AuthState = { mode: "loading", busy: false };
  private listeners = new Set<() => void>();
  constructor(transport: Transport) { this.transport = transport; }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<AuthState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(fn => fn()); }
  navigate(mode: "login" | "forgot" | "reset" | "enroll" | "home" | "rotate") {
    if (this.state.busy) return;
    this.update({ mode, error: undefined, notice: undefined, secret: undefined, codes: undefined });
  }
  private async run(action: () => Promise<void>) {
    if (this.state.busy) return;
    this.update({ busy: true, error: undefined, notice: undefined });
    try { await action(); }
    catch (error) {
      const ended = error instanceof AuthFailure && ["UNAUTHORIZED", "REAUTHENTICATION_REQUIRED"].includes(error.code);
      this.update({ error: errorMessage(error), ...(ended ? { mode: "login" as const, context: undefined, secret: undefined, codes: undefined } : {}) });
    } finally { this.update({ busy: false }); }
  }
  private async context() {
    const context = identityContext(await this.transport.request("/auth/me"));
    const modes = { email_verification: "verify", mfa_enrollment: "enroll", mfa_challenge: "mfa", ready: "home" } as const;
    this.update({ context, mode: modes[context.security.nextStep], secret: undefined, codes: undefined });
  }
  refresh = () => this.run(async () => {
    this.update({ mode: "loading", context: undefined, secret: undefined, codes: undefined });
    try { await this.context(); }
    catch (error) {
      if (error instanceof AuthFailure && error.code === "UNAUTHORIZED") { this.update({ mode: "login" }); return; }
      this.update({ mode: "unavailable" }); throw error;
    }
  });
  login = (email: string, password: string) => this.run(async () => {
    await this.transport.request("/auth/login", { email, password }); await this.context();
  });
  requestEmail = (email?: string) => this.run(async () => {
    await this.transport.request("/auth/email/request", { email: this.state.context?.user.email ?? email });
    this.update({ notice: "Se houver uma conta elegível, a mensagem será enviada. No ambiente de teste, consulte a caixa local." });
  });
  confirmEmail = (token: string) => this.run(async () => {
    await this.transport.request("/auth/email/confirm", { token: token.trim() });
    this.update({ mode: "login", context: undefined, notice: "Email confirmado. Entre novamente para continuar." });
  });
  requestReset = (email: string) => this.run(async () => {
    await this.transport.request("/auth/password/request", { email });
    this.update({ mode: "reset", notice: "Se a conta for elegível, enviaremos o código ao email confirmado. O pedido não altera sua senha." });
  });
  reset = (token: string, password: string, confirmation: string) => this.run(async () => {
    if (password !== confirmation) throw new AuthFailure("PASSWORD_MISMATCH");
    await this.transport.request("/auth/password/reset", { token: token.trim(), password });
    this.update({ mode: "login", context: undefined, notice: "Senha alterada e sessões antigas encerradas. Entre novamente; o segundo fator continua ativo." });
  });
  challenge = (code: string) => this.run(async () => {
    await this.transport.request("/auth/mfa/challenge", { code: code.trim() }); await this.context();
  });
  enroll = (password: string, code: string) => this.run(async () => {
    const result = await this.transport.request("/auth/mfa/enroll/start", { password, ...(this.state.context?.security.mfaEnabled ? { code: code.trim() } : {}) });
    if (typeof result.secret !== "string" || !/^[A-Z2-7]{32}$/.test(result.secret)) throw new AuthFailure("INVALID_RESPONSE");
    this.update({ secret: result.secret });
  });
  private async backups(result: Record<string, unknown>) {
    const codes = result.recoveryCodes;
    if (!Array.isArray(codes) || codes.length !== 10 || codes.some(code => typeof code !== "string" || !/^[a-f0-9]{32}$/.test(code))) throw new AuthFailure("INVALID_RESPONSE");
    // Os códigos não são persistidos pelo cliente e nunca entram na URL.
    // Não consultar /me aqui: uma falha de rede após a emissão não pode perder códigos.
    this.update({ mode: "backup", codes, secret: undefined });
  }
  confirmEnrollment = (code: string) => this.run(async () => { await this.backups(await this.transport.request("/auth/mfa/enroll/confirm", { code: code.trim() })); });
  rotate = (password: string, code: string) => this.run(async () => { await this.backups(await this.transport.request("/auth/mfa/recovery-codes", { password, code: code.trim() })); });
  acknowledgeBackups = () => this.refresh();
  logout = (all = false) => this.run(async () => {
    const result = await this.transport.request(all ? "/auth/logout-all" : "/auth/logout", {});
    await this.transport.clear();
    this.update({ mode: "login", context: undefined, secret: undefined, codes: undefined,
      notice: result.remoteRevoked === false ? "Sessão removida deste navegador. Não foi possível confirmar o encerramento no servidor." : all ? "Sessões da conta encerradas." : "Você saiu da conta." });
  });
  access = (municipalityId: string, permission: string) => this.run(async () => {
    await this.transport.request("/access?" + new URLSearchParams({ municipalityId, permission }));
    this.update({ notice: "Acesso confirmado pelo servidor. As funções operacionais desta área serão conectadas nos próximos blocos." });
  });
}
