/**
 * V5.16 — reconciliação SOMENTE LEITURA. Não há método de remover fotos.
 * Base HTML: cidadao-ai/index.html #trafficForm/submitTrafficForm
 * e shared/jeriflow-audit-citizen.js evidence().
 * ZIP SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 *
 * ATENÇÃO: resultado é uma fotografia temporal do banco, nunca autorização
 * duradoura para apagar algo. A consulta e o sistema de arquivos não
 * compartilham transação; não usar este relatório como lista de exclusão.
 */
import {createHash} from "node:crypto";
import pg from "pg";
import {TrafficCleanPhotoStoreV516,TrafficCleanPhotoError}
  from "./traffic-photo-clean-store-v516.ts";
import {uuid} from "./identity-primitives.ts";

export class TrafficPhotoReconciliationErrorV516 extends Error {
  readonly code:"RECONCILIATION_UNAVAILABLE"|"RECONCILIATION_INVALID_REQUEST";
  constructor(code:TrafficPhotoReconciliationErrorV516["code"]){
    super(code);this.code=code;
  }
}
export type TrafficPhotoReconciliationReportV516=Readonly<{
  evaluated:number;
  withScannerRecord:number;
  withoutScannerRecord:number;
  readablePrivateFiles:number;
  missingPrivateFiles:number;
  unsafeOrInconsistentFiles:number;
  // NUNCA devolve UUID, SHA, localizacao de arquivo ou PII.
  deletedFiles:0;
  deletedDatabaseRows:0;
  mode:"READ_ONLY";
}>;
type Candidate=Readonly<{
  municipality_id:string;photo_id:string;sha256:string;
  has_scanner_record:boolean;age_hours:number;
}>;
export class TrafficPhotoReconcilerV516 {
  private readonly pool:pg.Pool;
  private readonly store:TrafficCleanPhotoStoreV516;
  private constructor(pool:pg.Pool,store:TrafficCleanPhotoStoreV516){
    this.pool=pool;this.store=store;
  }
  static async openPrivate(input:Readonly<{
    reconcilerDatabaseUrl:string;cleanPhotoRoot:string;
  }>):Promise<TrafficPhotoReconcilerV516>{
    if(!input||typeof input.reconcilerDatabaseUrl!=="string"||
       !input.reconcilerDatabaseUrl)
      throw new TrafficPhotoReconciliationErrorV516("RECONCILIATION_UNAVAILABLE");
    let store:TrafficCleanPhotoStoreV516;
    try{store=await TrafficCleanPhotoStoreV516.openPrivate(input.cleanPhotoRoot);}
    catch{throw new TrafficPhotoReconciliationErrorV516("RECONCILIATION_UNAVAILABLE");}
    const pool=new pg.Pool({
      connectionString:input.reconcilerDatabaseUrl,
      max:1,connectionTimeoutMillis:2500,statement_timeout:10000,
      query_timeout:12000,application_name:"jeriflow-v516-photo-reconcile-readonly"
    });
    pool.on("error",()=>{});
    return new TrafficPhotoReconcilerV516(pool,store);
  }
  async close(){await this.pool.end();}
  /** Só agregados privados. NAO faz UNLINK, DELETE nem mudanca de estado. */
  async inspect(input:Readonly<{
    municipalityId:string;olderThanHours?:number;limit?:number;
  }>):Promise<TrafficPhotoReconciliationReportV516>{
    let mid:string;
    const hours=input?.olderThanHours??72,limit=input?.limit??50;
    try {
      mid=uuid(input.municipalityId);
      if(!Number.isSafeInteger(hours)||hours<72||hours>8760||
         !Number.isSafeInteger(limit)||limit<1||limit>100)
        throw new Error("INVALID_LIMIT");
    }catch{throw new TrafficPhotoReconciliationErrorV516("RECONCILIATION_INVALID_REQUEST");}
    let candidates:Candidate[];
    try {
      const result=await this.pool.query<Candidate>(
        "SELECT * FROM app.citizen_v516_traffic_reconcile_preview($1::uuid,$2::integer,$3::integer)",
        [mid,hours,limit]);
      candidates=result.rows;
      if(!Array.isArray(candidates)||candidates.length>limit)
        throw new Error("INVALID_DB_RESULT");
    }catch{throw new TrafficPhotoReconciliationErrorV516("RECONCILIATION_UNAVAILABLE");}
    let verified=0,unverified=0,readable=0,missing=0,unsafe=0;
    for(const candidate of candidates){
      if(candidate.municipality_id!==mid||candidate.has_scanner_record!==true&&
         candidate.has_scanner_record!==false||!Number.isSafeInteger(candidate.age_hours)||
         candidate.age_hours<hours||!/^[a-f0-9]{64}$/.test(candidate.sha256)){
        // Qualquer linha adulterada ou inconsistente falha fechada.
        throw new TrafficPhotoReconciliationErrorV516("RECONCILIATION_UNAVAILABLE");
      }
      if(candidate.has_scanner_record)verified++;else unverified++;
      try{
        const bytes=await this.store.readPrivate(mid,candidate.photo_id);
        const digest=createHash("sha256").update(bytes).digest("hex");
        if(digest!==candidate.sha256)unsafe++;
        else readable++;
      }catch(e){
        if(e instanceof TrafficCleanPhotoError && e.code==="PHOTO_NOT_FOUND")
          missing++;
        else unsafe++;
      }
    }
    return Object.freeze({
      evaluated:candidates.length,withScannerRecord:verified,
      withoutScannerRecord:unverified,readablePrivateFiles:readable,
      missingPrivateFiles:missing,unsafeOrInconsistentFiles:unsafe,
      deletedFiles:0 as const,deletedDatabaseRows:0 as const,mode:"READ_ONLY" as const,
    });
  }
}
