/**
 * Fronteira interna de identificação da denúncia de trânsito do Cidadão.
 * V5.16: cidadao-ai/index.html currentCitizen(), readFormIdentity(),
 * citizenSubmissionAllowed(); shared/jeriflow-audit-citizen.js formIdentity().
 * SHA-256 ZIP: 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 *
 * NÃO lê localStorage, NÃO confia em registered do cliente, NÃO cria protocolo,
 * upload, sessão, aprovação de evidência ou rota HTTP.
 */
import type { CitizenIdentityV516 } from "../../../packages/contracts/src/citizen-traffic-v516.ts";

/** Resposta de adaptador de sessão AUTORITATIVO, nunca de JSON do cliente. */
export type ServerCitizenAccountV516 = Readonly<{
  municipalityId: string;
  citizenId: string;
  name: string;
  birthDate: string;
  phone: string;
  address: string;
  login: string;
  active: boolean;
  blocked: boolean;
}>;
/** Identificação manual do visitante, como no HTML original. */
export type GuestTrafficIdentityV516 = Readonly<{
  name: string;
  birthDate: string;
  phone: string;
}>;
/** Este resolver real ainda NÃO está integrado à autenticação em produção. */
export type CitizenSessionResolverV516 = (
  sessionToken: string,
  municipalityId: string,
) => Promise<ServerCitizenAccountV516 | null>;

export class TrafficCitizenIdentityErrorV516 extends Error {
  readonly code: "CITIZEN_SESSION_INVALID" | "CITIZEN_SUBMISSION_BLOCKED" |
    "CITIZEN_IDENTITY_REQUIRED" | "CITIZEN_IDENTITY_UNAVAILABLE";
  constructor(code: TrafficCitizenIdentityErrorV516["code"]) {
    super(code); this.code = code;
  }
}
const validText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * A rota futura deve extrair sessionToken somente do cabeçalho autenticado,
 * NUNCA do corpo da denúncia. Presença de sessão inválida falha fechada:
 * não reduz acesso para visitante. Cliente nunca decide o campo registered.
 */
export async function resolveTrafficCitizenIdentityV516(args: Readonly<{
  municipalityId: string;
  sessionToken?: string | null;
  guest?: GuestTrafficIdentityV516 | null;
}>, resolveSession: CitizenSessionResolverV516): Promise<CitizenIdentityV516> {
  if (!validText(args.municipalityId))
    throw new TrafficCitizenIdentityErrorV516("CITIZEN_IDENTITY_UNAVAILABLE");

  if (args.sessionToken !== undefined && args.sessionToken !== null) {
    if (!validText(args.sessionToken))
      throw new TrafficCitizenIdentityErrorV516("CITIZEN_SESSION_INVALID");
    let account: ServerCitizenAccountV516 | null;
    try { account = await resolveSession(args.sessionToken, args.municipalityId); }
    catch { throw new TrafficCitizenIdentityErrorV516("CITIZEN_IDENTITY_UNAVAILABLE"); }
    if (!account || account.active !== true || account.municipalityId !== args.municipalityId ||
      !validText(account.citizenId) || !validText(account.name) || !validText(account.login))
      throw new TrafficCitizenIdentityErrorV516("CITIZEN_SESSION_INVALID");
    if (account.blocked !== false)
      throw new TrafficCitizenIdentityErrorV516("CITIZEN_SUBMISSION_BLOCKED");
    return Object.freeze({
      registered: true,
      citizenId: account.citizenId,
      name: account.name,
      birthDate: account.birthDate || "",
      phone: account.phone || "",
      address: account.address || "",
      login: account.login,
    });
  }

  // Exatamente os três campos exigidos de visitante por readFormIdentity().
  const guest = args.guest;
  if (!validText(guest?.name) || !validText(guest?.birthDate) || !validText(guest?.phone))
    throw new TrafficCitizenIdentityErrorV516("CITIZEN_IDENTITY_REQUIRED");
  return Object.freeze({
    registered: false,
    citizenId: "",
    name: guest.name.trim(),
    birthDate: guest.birthDate.trim(),
    phone: guest.phone.trim(),
    address: "",
    login: "",
  });
}
