export const authMethods: Record<string, "GET" | "POST"> = {
  "/auth/login": "POST", "/auth/me": "GET", "/auth/logout": "POST", "/auth/logout-all": "POST",
  "/auth/email/request": "POST", "/auth/email/confirm": "POST", "/auth/password/request": "POST", "/auth/password/reset": "POST",
  "/auth/mfa/enroll/start": "POST", "/auth/mfa/enroll/confirm": "POST", "/auth/mfa/challenge": "POST", "/auth/mfa/recovery-codes": "POST",
  "/auth/registration/request": "POST", "/auth/registration/complete": "POST", "/auth/municipalities": "POST", "/auth/public-profile": "POST",
  "/management/query": "POST", "/management/mutate": "POST",
  "/ouvidoria/query": "POST", "/ouvidoria/mutate": "POST",
  "/ouvidoria/history": "POST",
  "/ouvidoria/attachments/upload": "POST", "/ouvidoria/attachments/list": "POST",
  "/ouvidoria/notices/query": "POST", "/ouvidoria/notices/read": "POST", "/ouvidoria/retention/review": "POST",
  "/ouvidoria/retention/inventory": "POST", "/ouvidoria/retention/draft": "POST",
  "/ouvidoria/retention/archive": "POST",
  "/guarda/query": "POST", "/guarda/mutate": "POST", "/guarda/history": "POST",
};
export const panelPermissions: Record<string, string> = {
  mestre: "admin:mestre:access", turismo: "admin:turismo:access", cidadao: "admin:cidadao:access",
  semus: "admin:semus:access", conteudo: "admin:conteudo:access", dashboard: "admin:dashboard:access", studio: "admin:studio:access",
};
export type IdentityContext = {
  user: { id: string; email: string; displayName: string };
  municipalities: { id: string; displayName: string; roles: string[]; permissions: string[] }[];
  platformPermissions: string[];
  security: { emailVerified: boolean; mfaEnabled: boolean; mfaRequired: boolean; nextStep: "email_verification" | "mfa_enrollment" | "mfa_challenge" | "ready" };
};
export function identityContext(value: unknown): IdentityContext {
  const v = value as IdentityContext;
  if (!v || !v.user || typeof v.user.id !== "string" || typeof v.user.email !== "string" || typeof v.user.displayName !== "string"
    || !Array.isArray(v.municipalities) || v.municipalities.some(m => !m || typeof m.id !== "string" || typeof m.displayName !== "string"
      || !Array.isArray(m.roles) || m.roles.some(r => typeof r !== "string") || !Array.isArray(m.permissions) || m.permissions.some(p => typeof p !== "string"))
    || !Array.isArray(v.platformPermissions) || v.platformPermissions.some(p => typeof p !== "string") || !v.security
    || typeof v.security.emailVerified !== "boolean" || typeof v.security.mfaEnabled !== "boolean" || typeof v.security.mfaRequired !== "boolean"
    || !["email_verification", "mfa_enrollment", "mfa_challenge", "ready"].includes(v.security.nextStep)) throw new Error("INVALID_IDENTITY_RESPONSE");
  return v;
}
export const canonicalToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value);
