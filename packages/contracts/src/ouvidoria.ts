export type ProtocolStatus = "open" | "in_review" | "responded" | "contested" | "closed";
export type ProtocolCategory = "denuncia" | "reclamacao" | "solicitacao" | "sugestao";
export type ProtocolRecord = {
  id: string; municipalityId: string; category: ProtocolCategory;
  title: string; description: string; status: ProtocolStatus;
  response: string | null; contestNote: string | null; contestCount: number;
  revision: number; createdAt: string; updatedAt: string;
};
export const protocolStatusLabels: Record<ProtocolStatus,string> = {
  open:"Recebido", in_review:"Em análise", responded:"Respondido",
  contested:"Contestado", closed:"Encerrado"
};
export const protocolCategories: Record<ProtocolCategory,string> = {
  denuncia:"Denúncia", reclamacao:"Reclamação",
  solicitacao:"Solicitação", sugestao:"Sugestão"
};
export function readProtocolPage(value: Record<string,unknown>): {items: ProtocolRecord[];next:string|null} {
  const rows=value.items, next=value.next;
  if(!Array.isArray(rows)||rows.length>20||!(next===null||typeof next==="string")) throw new Error("INVALID_RESPONSE");
  for(const row of rows){
    if(!row||typeof row!=="object"||!["open","in_review","responded","contested","closed"].includes(row.status)
      || !Object.hasOwn(protocolCategories,row.category)
      || ["id","municipalityId","title","description","createdAt","updatedAt"].some(k=>typeof row[k]!=="string")
      || !(row.response===null||typeof row.response==="string")
      || !(row.contestNote===null||typeof row.contestNote==="string")
      || !Number.isSafeInteger(row.contestCount)||!Number.isSafeInteger(row.revision)||row.revision<1)
      throw new Error("INVALID_RESPONSE");
  }
  return {items:rows as ProtocolRecord[],next:next as string|null};
}
export function protocolMutationResult(value: Record<string,unknown>): { protocolId:string;status:ProtocolStatus;revision:number } {
  if(typeof value.protocolId!=="string"||!["open","in_review","responded","contested","closed"].includes(String(value.status))
    ||!Number.isSafeInteger(value.revision)) throw new Error("INVALID_RESPONSE");
  return value as { protocolId:string;status:ProtocolStatus;revision:number };
}
