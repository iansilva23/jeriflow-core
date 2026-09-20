import { actionHash } from "./identity-security.ts";
import { emailAddress } from "./identity-primitives.ts";

export const localMailbox = "http://127.0.0.1:58025";
const subjects = {
  "verify-email": "JeriFlow — confirme seu email",
  "reset-password": "JeriFlow — recuperação de senha",
  "password-changed": "JeriFlow — sua senha foi alterada",
  "mfa-changed": "JeriFlow — proteção em duas etapas atualizada",
  "recovery-used": "JeriFlow — um código de recuperação foi utilizado",
  "complete-registration": "JeriFlow — conclua seu cadastro",
  "access-changed": "JeriFlow — seus acessos foram atualizados",
};
// Apenas caixa de teste: não configura relay SMTP nem envia para provedores externos.
export async function sendLocalIdentityMail(payload: { email: string; purpose: keyof typeof subjects; token?: string }) {
  if (process.env.NODE_ENV === "production") throw new Error("LOCAL_MAIL_ONLY");
  const email = emailAddress(payload.email);
  if (!Object.hasOwn(subjects, payload.purpose)) throw new Error("INVALID_MAIL_PURPOSE");
  let text = subjects[payload.purpose] + ".\nSe você não solicitou esta ação, entre em contato com o responsável pelo sistema.";
  if (["verify-email", "reset-password", "complete-registration"].includes(payload.purpose)) {
    actionHash(payload.token);
    text = subjects[payload.purpose] + ".\nUse o código abaixo na tela correspondente. Válido por 30 minutos, uma única vez.\n"
      + payload.token + "\nNão compartilhe este código. Se não solicitou, ignore a mensagem.";
  }
  const response = await fetch(localMailbox + "/api/v1/send", { method: "POST", redirect: "error", signal: AbortSignal.timeout(2000),
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ From: { Email: "nao-responda@jeriflow.invalid", Name: "JeriFlow TESTE" },
      To: [{ Email: email }], Subject: subjects[payload.purpose], Text: text, Tags: ["jeriflow", payload.purpose] }) });
  await response.body?.cancel();
  if (!response.ok) throw new Error("LOCAL_MAIL_UNAVAILABLE");
}
