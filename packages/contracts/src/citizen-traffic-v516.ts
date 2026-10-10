/**
 * Contrato funcional 1:1 do HTML V5.16. Não faz IO, não emite protocolos oficiais,
 * não recebe arquivos, não cria sessões e não libera dados pessoais.
 *
 * FONTES VERIFICADAS:
 * cidadao-ai/index.html #trafficForm, submitTrafficForm(), readFormIdentity()
 * guarda-semus/index.html allTraffic(), acceptReport(), finishBtn
 * admin-semus/index.html reopen(), closeAdmin()
 * ZIP V5.16 SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 */
export const TRAFFIC_TYPES_V516 = [
  "Estacionamento irregular",
  "Veículo bloqueando acesso/garagem",
  "Veículo em área proibida",
  "Via parcialmente bloqueada",
  "Circulação irregular",
  "Transporte irregular",
  "Outro problema de trânsito",
] as const;

export const SERVICE_RESULTS_V516 = [
  "Veículo encontrado",
  "Veículo não encontrado",
  "Situação já resolvida",
  "Denúncia não confirmada",
] as const;

export const SERVICE_ACTIONS_V516 = [
  "Orientação realizada",
  "Autuação realizada",
  "Veículo removido/direcionado",
  "Solicitado apoio",
  "Sem providência necessária",
] as const;

export const CITIZEN_REPORT_REASONS_V516 = [
  "Trote / denúncia falsa",
  "Informação deliberadamente incorreta",
  "Uso abusivo do canal",
  "Reincidência",
  "Outro",
] as const;

export type CitizenReportReasonV516 = typeof CITIZEN_REPORT_REASONS_V516[number];
export type TrafficTypeV516 = typeof TRAFFIC_TYPES_V516[number];
export type ServiceResultV516 = typeof SERVICE_RESULTS_V516[number];
export type ServiceActionV516 = typeof SERVICE_ACTIONS_V516[number];
export type TrafficStatusV516 = "RECEBIDA" | "EM ATENDIMENTO" | "FINALIZADA";

export type CitizenIdentityV516 = {
  registered: boolean;
  citizenId: string;
  name: string;
  birthDate: string;
  phone: string;
  address: string;
  login: string;
};

export type TrafficDraftV516 = {
  type: string;
  location: string;
  plate: string;
  description: string;
  /** Apenas checagem de UI. O servidor deverá verificar os bytes reais da imagem. */
  photoSelected: boolean;
  identity: CitizenIdentityV516 | null;
  /** Equivalente a citizenSubmissionAllowed() após a verificação de moderação. */
  submissionBlocked?: boolean;
};

export type TrafficValidationV516 =
  | { ok: false; message: string }
  | { ok: true; fields: Omit<TrafficDraftV516, "submissionBlocked"> & { type: TrafficTypeV516; identity: CitizenIdentityV516 } };

function oneOf<const T extends readonly string[]>(value: string, choices: T): value is T[number] {
  return (choices as readonly string[]).includes(value);
}
function identityPresent(identity: CitizenIdentityV516 | null): identity is CitizenIdentityV516 {
  return !!identity && !!identity.name?.trim() && !!identity.birthDate?.trim() && !!identity.phone?.trim();
}

/** Mesma ordem e mensagens de validação de submitTrafficForm() na V5.16. */
export function validateTrafficDraftV516(draft: TrafficDraftV516): TrafficValidationV516 {
  if (draft.submissionBlocked)
    return { ok: false, message: "Sua conta possui uma restrição administrativa ativa e não pode enviar novas solicitações." };
  const type = draft.type.trim(), location = draft.location.trim();
  const plate = draft.plate.trim().toUpperCase(), description = draft.description.trim();
  if (!type || !oneOf(type, TRAFFIC_TYPES_V516))
    return { ok: false, message: "Selecione o tipo de ocorrência." };
  if (!location) return { ok: false, message: "Informe o local da ocorrência." };
  if (!description) return { ok: false, message: "Descreva o que está acontecendo." };
  if (!draft.photoSelected) return { ok: false, message: "A foto é obrigatória para enviar a denúncia." };
  if (!identityPresent(draft.identity))
    return { ok: false, message: "Informe nome completo, data de nascimento e telefone." };
  // O HTML limita a entrada da placa a oito caracteres no próprio input.
  // Não inventar limite de descrição/nome não existente no protótipo.
  if (plate.length > 8) return { ok: false, message: "A placa deve ter no máximo 8 caracteres." };
  return { ok: true, fields: {
    type, location, plate, description, photoSelected: true,
    identity: { ...draft.identity, name: draft.identity.name.trim(),
      birthDate: draft.identity.birthDate.trim(), phone: draft.identity.phone.trim() },
  } };
}

export type GuardActorV516 = { id: string; name: string; login: string };
export type CitizenFlagV516 = { status: "EM ANÁLISE"; reason: string; note: string; createdAt: string; guard: GuardActorV516 };
export type TrafficAdministrativeEventV516 = { at: string; action: "REABERTA"; previousStatus: TrafficStatusV516; by: string };

export type CitizenTrafficProtocolV516 = {
  id: string;
  title: TrafficTypeV516;
  category: "Trânsito (SEMUS)";
  destination: "SEMUS / Guarda de trânsito";
  status: TrafficStatusV516;
  description: string;
  location: string;
  plate: string;
  hasPhoto: true;
  identity: CitizenIdentityV516;
  createdAt: string;
  meta: string[];
  updatedAt?: string;
  acceptedAt?: string | null;
  acceptedBy?: GuardActorV516 | null;
  assignedGuard?: GuardActorV516 | null;
  finishedAt?: string | null;
  finishedBy?: GuardActorV516 | null;
  serviceResult?: string;
  serviceAction?: string;
  serviceNote?: string;
  citizenFlag?: CitizenFlagV516;
  semusAdministrativeHistory?: TrafficAdministrativeEventV516[];
};

/**
 * Somente constrói o REGISTRO EM MEMÓRIA após o adaptador verificar a foto
 * real, sua origem e armazenamento. photoSelected NÃO é prova do upload.
 */
export function trafficProtocolAfterVerifiedPhotoV516(
  validation: TrafficValidationV516,
  evidenceStoredAndVerified: boolean,
  protocolId: string,
  createdAt: string,
): CitizenTrafficProtocolV516 {
  if (!validation.ok || !evidenceStoredAndVerified || !protocolId || !Number.isFinite(Date.parse(createdAt)))
    throw new Error("TRAFFIC_V516_NOT_READY");
  const { type, location, plate, description, identity } = validation.fields;
  return {
    id: protocolId, title: type, category: "Trânsito (SEMUS)",
    destination: "SEMUS / Guarda de trânsito", status: "RECEBIDA",
    description, location, plate, hasPhoto: true, identity: { ...identity },
    createdAt, meta: [location, plate].filter(Boolean),
  };
}
function ensureTime(value: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error("INVALID_TIME");
}
function ensureGuard(actor: GuardActorV516) {
  if (!actor || !actor.id || !actor.name || !actor.login) throw new Error("UNAUTHORIZED_GUARD");
}
/** Guardas alteram sempre o MESMO protocolo originado no Cidadão. */
export function acceptTrafficV516(protocol: CitizenTrafficProtocolV516, guard: GuardActorV516, at: string) {
  ensureGuard(guard); ensureTime(at);
  if (protocol.status !== "RECEBIDA") throw new Error("INVALID_TRAFFIC_TRANSITION");
  return { ...protocol, status: "EM ATENDIMENTO" as const,
    acceptedAt: at, assignedGuard: { ...guard }, updatedAt: at };
}
export function finishTrafficV516(
  protocol: CitizenTrafficProtocolV516, guard: GuardActorV516, at: string,
  result: ServiceResultV516, action: ServiceActionV516, note: string,
) {
  ensureGuard(guard); ensureTime(at);
  if (protocol.status !== "EM ATENDIMENTO" || !oneOf(result, SERVICE_RESULTS_V516) ||
    !oneOf(action, SERVICE_ACTIONS_V516)) throw new Error("INVALID_TRAFFIC_TRANSITION");
  // A V5.16 permite observação vazia e usa valores pré-definidos dos seletores.
  return { ...protocol, status: "FINALIZADA" as const,
    serviceResult: result, serviceAction: action, serviceNote: note.trim(),
    finishedAt: at, finishedBy: { ...guard }, updatedAt: at };
}
export function reopenTrafficV516(protocol: CitizenTrafficProtocolV516, adminName: string, at: string) {
  ensureTime(at);
  if (!adminName.trim() || protocol.status !== "FINALIZADA") throw new Error("INVALID_TRAFFIC_TRANSITION");
  const history = [...(protocol.semusAdministrativeHistory ?? []),
    { at, action: "REABERTA" as const, previousStatus: protocol.status, by: adminName.trim() }];
  return { ...protocol, status: "RECEBIDA" as const,
    acceptedAt: null, acceptedBy: null, finishedAt: null, finishedBy: null,
    semusAdministrativeHistory: history, updatedAt: at };
}
export function administrativeFinishTrafficV516(
  protocol: CitizenTrafficProtocolV516, admin: GuardActorV516, reason: string, at: string,
) {
  ensureGuard(admin); ensureTime(at);
  if (protocol.status === "FINALIZADA") throw new Error("INVALID_TRAFFIC_TRANSITION");
  if (!reason.trim()) throw new Error("ADMIN_REASON_REQUIRED");
  return { ...protocol, status: "FINALIZADA" as const,
    serviceResult: "Encerrada administrativamente",
    serviceAction: "Decisão administrativa", serviceNote: reason.trim(),
    finishedAt: at, finishedBy: { ...admin }, updatedAt: at };
}
export function flagCitizenV516(
  protocol: CitizenTrafficProtocolV516, guard: GuardActorV516,
  reason: CitizenReportReasonV516, note: string, at: string,
) {
  ensureGuard(guard); ensureTime(at);
  if (protocol.status !== "EM ATENDIMENTO" ||
      !oneOf(reason, CITIZEN_REPORT_REASONS_V516)) throw new Error("INVALID_TRAFFIC_TRANSITION");
  return { ...protocol, citizenFlag: {
    status: "EM ANÁLISE" as const, reason, note: note.trim(), createdAt: at, guard: { ...guard },
  }, updatedAt: at };
}
