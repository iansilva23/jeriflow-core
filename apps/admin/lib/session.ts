import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookieToken, gatewayConfig, serverContext, upstream } from "./gateway";
export async function authenticatedAdmin() {
  const h = await headers(), config = gatewayConfig();
  if (h.get("host") !== new URL(config.origin).host) throw new Error("UNTRUSTED_ADMIN_HOST");
  const cookie = h.get("cookie"), context = await serverContext(cookie, config);
  if (!context || context.security.nextStep !== "ready") redirect("/entrar");
  return { context, cookie, config };
}
export async function authorizePanel(permission: string, municipalityId?: string) {
  const session = await authenticatedAdmin();
  if (municipalityId && !/^[0-9a-f-]{36}$/.test(municipalityId)) return { ...session, allowed: false };
  const query = new URLSearchParams({ permission, ...(municipalityId ? { municipalityId } : {}) });
  const result = await upstream(session.config, "/access?" + query, cookieToken(session.cookie));
  if (result.status === 401) redirect("/entrar");
  if (![200,403,400].includes(result.status)) throw new Error("IDENTITY_UNAVAILABLE");
  return { ...session, allowed: result.status === 200 && result.data.allowed === true };
}
