/**
 * JeriFlow V5.16 — processamento INTERNO de fotografia obrigatória de trânsito.
 * Referência de produto: cidadao-ai/index.html #trafficForm/submitTrafficForm()
 * e shared/jeriflow-audit-citizen.js evidence()/formIdentity().
 * ZIP original SHA-256:
 * 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 *
 * Não é endpoint. Não cria protocolo ou URL pública. Somente conta autenticada.
 * Visitantes seguem previstos no HTML V5.16, mas o deviceId local não é prova
 * de posse no backend; portanto, NÃO entra neste pipeline ainda.
 */
import {sessionHash,uuid} from "./identity-primitives.ts";
import {examineTrafficPhotoCandidate, type TrafficPhotoMime} from "./traffic-photo-candidate.ts";
import {TrafficPhotoQuarantineV516} from "./traffic-photo-quarantine.ts";
import {normalizeUntrustedTrafficPhotoV516} from "./traffic-photo-normalize-v516.ts";
import {
  TrafficCleanPhotoStoreV516,type CleanPhotoTicketV516
} from "./traffic-photo-clean-store-v516.ts";
import {TrafficPhotoOwnershipV516} from "./traffic-photo-ownership-v516.ts";
import {OfficialTrafficPhotoWorkerV516} from "./traffic-photo-official-worker-v516.ts";
import type {CitizenSessionResolverV516} from "./traffic-citizen-identity-v516.ts";
import type {TrafficPhotoHttpDependenciesV516} from "./traffic-photo-http-v516.ts";

export type PrivateTrafficPhotoReceiptV516=Readonly<{
  // SOMENTE para a próxima transação privada do protocolo canônico.
  municipalityId:string;photoId:string;sha256:string;
  registeredForProtocol:true;protocolCreated:false;
  evidenceApproved:false;publicUrl:null;
}>;
export class TrafficPhotoPipelineErrorV516 extends Error {
  readonly code:"TRAFFIC_PHOTO_PIPELINE_INVALID"|
    "TRAFFIC_PHOTO_PIPELINE_UNAVAILABLE";
  constructor(code:TrafficPhotoPipelineErrorV516["code"]){
    super(code);this.code=code;
  }
}
/** Não aceitar um produtor genérico de tickets/flags vindo do request. */
export class TrafficPhotoPrivatePipelineV516 {
  private readonly quarantine:TrafficPhotoQuarantineV516;
  private readonly cleanStore:TrafficCleanPhotoStoreV516;
  private readonly ownership:Pick<TrafficPhotoOwnershipV516,"reserveRegistered">;
  private readonly worker:Pick<OfficialTrafficPhotoWorkerV516,"verifyAndRegister">;
  private constructor(
    quarantine:TrafficPhotoQuarantineV516,
    cleanStore:TrafficCleanPhotoStoreV516,
    ownership:Pick<TrafficPhotoOwnershipV516,"reserveRegistered">,
    worker:Pick<OfficialTrafficPhotoWorkerV516,"verifyAndRegister">,
  ){
    this.quarantine=quarantine;
    this.cleanStore=cleanStore;
    this.ownership=ownership;
    this.worker=worker;
  }
  static async openPrivate(input:Readonly<{
    quarantineDirectory:string;
    cleanPhotoRoot:string;
    ownership:Pick<TrafficPhotoOwnershipV516,"reserveRegistered">;
    worker:Pick<OfficialTrafficPhotoWorkerV516,"verifyAndRegister">;
  }>):Promise<TrafficPhotoPrivatePipelineV516>{
    if(!input?.ownership||typeof input.ownership.reserveRegistered!=="function"||
       !input.worker||typeof input.worker.verifyAndRegister!=="function")
      throw new TrafficPhotoPipelineErrorV516("TRAFFIC_PHOTO_PIPELINE_INVALID");
    const quarantine=await TrafficPhotoQuarantineV516.openPrivate(input.quarantineDirectory);
    const store=await TrafficCleanPhotoStoreV516.openPrivate(input.cleanPhotoRoot);
    return new TrafficPhotoPrivatePipelineV516(quarantine,store,input.ownership,input.worker);
  }
  /**
   * Fluxo: validar bytes -> quarentena -> reencodar sem EXIF -> armazenamento
   * privado -> excluir arquivo BRUTO -> reservar ao titular com sessão REAL ->
   * verificação ClamAV OFICIAL -> gate PostgreSQL.
   *
   * Somente a futura transação citizen_v516_traffic_submit pode emitir o
   * protocolo. Nunca retornar este recibo diretamente ao aparelho.
   */
  async receiveRegistered(input:Readonly<{
    municipalityId:string;sessionToken:string;
    bytes:Uint8Array;suppliedMime?:TrafficPhotoMime;
  }>):Promise<PrivateTrafficPhotoReceiptV516>{
    let mid:string;
    try {
      mid=uuid(input.municipalityId);
      sessionHash(input.sessionToken); // rejeitar Bearer malformado cedo
      examineTrafficPhotoCandidate(input.bytes,input.suppliedMime);
    }catch {
      throw new TrafficPhotoPipelineErrorV516("TRAFFIC_PHOTO_PIPELINE_INVALID");
    }
    const raw=await this.quarantine.stage(input.bytes,input.suppliedMime);
    let clean:CleanPhotoTicketV516|undefined;
    let reserved=false;
    try{
      // Descartar a foto bruta até em erro de decodificação, sem aguardar scan.
      try {
        const image=await normalizeUntrustedTrafficPhotoV516(
          this.quarantine,raw.id,input.suppliedMime);
        clean=await this.cleanStore.store(mid,image);
      }finally{
        await this.quarantine.discard(raw.id);
      }
      if(!clean)
        throw new TrafficPhotoPipelineErrorV516("TRAFFIC_PHOTO_PIPELINE_UNAVAILABLE");

      // O SQL confere hash da sessão, conta atual, bloqueios e município.
      await this.ownership.reserveRegistered({
        municipalityId:mid,sessionToken:input.sessionToken,ticket:clean
      });
      reserved=true;
      const scanned=await this.worker.verifyAndRegister(clean);
      if(scanned.registeredForProtocol!==true||scanned.malwareScanned!==true||
        scanned.malwareFound!==false||scanned.publicUrl!==null||
        scanned.protocolCreated!==false||scanned.evidenceApproved!==false||
        scanned.sha256!==clean.sha256||scanned.photoId!==clean.photoId||
        scanned.municipalityId!==mid) {
        throw new TrafficPhotoPipelineErrorV516("TRAFFIC_PHOTO_PIPELINE_UNAVAILABLE");
      }
      return Object.freeze({
        municipalityId:mid,photoId:clean.photoId,sha256:clean.sha256,
        registeredForProtocol:true,protocolCreated:false,
        evidenceApproved:false,publicUrl:null
      });
    }catch(e){
      // Se não houve reserva, remover a foto privada que ainda não pertence
      // a ninguém. Se já houve reserva, NÃO excluir cegamente a mídia: pode
      // haver um gate SQL gravado; janitor transacional ainda está pendente.
      if(clean&&!reserved)
        await this.cleanStore.discardUnlinked(mid,clean.photoId).catch(()=>{});
      throw e;
    }
  }
}

/**
 * Adaptador privado para a rota HTTP já existente na PR30. Recebe Bearer
 * somente do servidor após validação de sessão e NÃO liga a rota no main.ts.
 * Os bytes NUNCA vêm de um ticket de foto criado pelo navegador.
 */
export function createPrivateTrafficPhotoHttpAdapterV516(input:Readonly<{
  resolveSession:CitizenSessionResolverV516;
  pipeline:TrafficPhotoPrivatePipelineV516;
}>):TrafficPhotoHttpDependenciesV516{
  if(!input?.resolveSession||!input.pipeline)
    throw new TrafficPhotoPipelineErrorV516("TRAFFIC_PHOTO_PIPELINE_INVALID");
  return Object.freeze({
    resolveSession:input.resolveSession,
    async ingestVerifiedPhoto(payload,sessionToken){
      await input.pipeline.receiveRegistered({
        municipalityId:payload.context.municipalityId,
        sessionToken,bytes:payload.bytes,suppliedMime:payload.suppliedMime,
      });
      // Proibido devolver photoId ou recibo privado ao HTTP.
    }
  });
}
