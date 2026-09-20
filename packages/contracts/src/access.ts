// Acesso ao módulo não substitui autorização de cada operação de negócio.
export const rolePermissions = {
  cidadao: ["mobile:cidadao:access"],
  turista: ["mobile:turista:access"],
  guarda: ["mobile:guarda:access"],
  "fiscal-tts": ["mobile:fiscal-tts:access"],
  "admin-turismo": ["admin:turismo:access"],
  "admin-cidadao": ["admin:cidadao:access"],
  "admin-semus": ["admin:semus:access"],
  "admin-conteudo": ["admin:conteudo:access"],
  "admin-dashboard": ["admin:dashboard:access"],
  "admin-studio": ["admin:studio:access"],
  // TTS administrativa fica no painel Turismo; não é o app Fiscal TTS.
  "admin-tts": ["tts:admin:access"],
} as const;
export type TenantRole = keyof typeof rolePermissions;
export const platformPermissions = ["admin:mestre:access"] as const;
export const permissionCatalog: readonly string[] = [...new Set([
  ...Object.values(rolePermissions).flat(), ...platformPermissions,
])];
export function permissionsFor(roles: readonly string[]): string[] {
  return [...new Set(roles.flatMap(role => Object.hasOwn(rolePermissions, role)
    ? [...rolePermissions[role as TenantRole]] : []))].sort();
}
