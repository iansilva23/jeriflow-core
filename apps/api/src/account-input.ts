import { displayName, emailAddress, exactObject, IdentityError, passwordValue, uuid } from "./identity-primitives.ts";
import { rolePermissions } from "../../../packages/contracts/src/access.ts";

export function publicProfile(input: unknown) {
  const body = exactObject(input, ["municipalityId", "role"]);
  if (body.role !== "cidadao" && body.role !== "turista") throw new IdentityError(400, "INVALID_PUBLIC_PROFILE");
  return { municipalityId: uuid(body.municipalityId), role: body.role };
}
export function managementQuery(input: unknown) {
  const body = exactObject(input, ["kind", "after", "municipalityId"]);
  if (typeof body.kind !== "string" || !["municipalities", "accounts"].includes(body.kind)) throw new IdentityError(400, "INVALID_INPUT");
  if (body.kind === "municipalities" && body.municipalityId !== undefined) throw new IdentityError(400, "INVALID_INPUT");
  return { kind: body.kind as "municipalities" | "accounts", after: body.after === undefined ? null : uuid(body.after),
    municipalityId: body.municipalityId === undefined ? null : uuid(body.municipalityId) };
}
export function managementMutation(input: unknown) {
  const b = exactObject(input, ["operation", "password", "code", "email", "displayName", "slug", "userId", "municipalityId", "roles", "active", "revision"]);
  const common = ["operation", "password", "code"];
  const password = passwordValue(b.password);
  if (typeof b.code !== "string" || !/^(?:\d{6}|[a-f0-9]{32})$/.test(b.code)) throw new IdentityError(400, "INVALID_INPUT");
  let data: Record<string, unknown>;
  if (b.operation === "create-municipality") {
    exactObject(b, [...common, "slug", "displayName"]);
    if (typeof b.slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(b.slug)) throw new IdentityError(400, "INVALID_INPUT");
    data = { operation: b.operation, slug: b.slug, displayName: displayName(b.displayName) };
  } else if (b.operation === "invite" || b.operation === "set-membership") {
    exactObject(b, [...common, "municipalityId", "roles", ...(b.operation === "invite" ? ["email"] : ["userId", "revision"])]);
    if (!Array.isArray(b.roles) || b.roles.length > 11 || (b.operation === "invite" && !b.roles.length)
      || b.roles.some(r => typeof r !== "string" || !Object.hasOwn(rolePermissions, r)) || new Set(b.roles).size !== b.roles.length)
      throw new IdentityError(400, "INVALID_INPUT");
    data = { operation: b.operation, municipalityId: uuid(b.municipalityId), roles: [...b.roles].sort(),
      ...(b.operation === "invite" ? { email: emailAddress(b.email) } : { userId: uuid(b.userId), revision: b.revision }) };
  } else if (b.operation === "set-active") {
    exactObject(b, [...common, "userId", "revision", "active"]);
    if (typeof b.active !== "boolean") throw new IdentityError(400, "INVALID_INPUT");
    data = { operation: b.operation, userId: uuid(b.userId), revision: b.revision, active: b.active };
  } else throw new IdentityError(400, "INVALID_INPUT");
  if (["set-active", "set-membership"].includes(String(b.operation)) && (!Number.isSafeInteger(b.revision) || Number(b.revision) < 1 || Number(b.revision) > 2147483647))
    throw new IdentityError(400, "INVALID_INPUT");
  return { data, password, code: b.code };
}
