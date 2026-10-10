/**
 * Worker interno da fotografia OBRIGATÓRIA do formulário Trânsito V5.16.
 * HTML fonte: cidadao-ai/index.html #trafficForm/submitTrafficForm() e
 * shared/jeriflow-audit-citizen.js evidence() (8 MiB, 1200px, qualidade 0.7).
 * ZIP: 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 *
 * NÃO é rota HTTP, não cria protocolo, não aprova evidência, não libera
 * pagamento, não conecta dados pessoais e não aceita flags de scanner do cliente.
 * A credencial do worker DEVE ser isolada da credencial da API.
 */
import pg from "pg";
import { createHash, timingSafeEqual } from "node:crypto";
import { TrafficCleanPhotoStoreV516, type CleanPhotoTicketV516 } from "./traffic-photo-clean-store-v516.ts";
import {scanStoredTrafficPhotoV516, type TrafficMalwareScanV516} from "./traffic-photo-malware-v516.ts";

const HEX=/^[a-f0-9]{64}$/;
function sameSha(actual:Buffer, expected:string):boolean {
  return HEX.test(expected) &&
    timingSafeEqual(createHash("sha256").update(actual).digest(),Buffer.from(expected,"hex"));
}
export class TrafficPhotoWorkerErrorV516 extends Error {
  readonly code:"PHOTO_WORKER_DB_UNAVAILABLE"|"PHOTO_WORKER_ROLE_DENIED"|"PHOTO_WORKER_INTEGRITY_FAILURE";
  constructor(code:TrafficPhotoWorkerErrorV516["code"]){super(code);this.code=code;}
}
export type VerifiedPhotoGateTicketV516=TrafficMalwareScanV516 &
  Readonly<{registeredForProtocol:true}>;

/**
 * Use apenas em processo interno de confiança: pasta privada/clamd Unix socket
 * e DSN exclusivo do worker, sem imports do servidor público.
 */
export class TrafficPhotoVerificationWorkerV516 {
  private readonly pool:pg.Pool;
  private readonly store:TrafficCleanPhotoStoreV516;
  private readonly clamdSocketPath:string;
  private constructor(
    store:TrafficCleanPhotoStoreV516,
    clamdSocketPath:string,
    workerDatabaseUrl:string,
  ){
    this.store=store;
    this.clamdSocketPath=clamdSocketPath;
    if(!clamdSocketPath.startsWith("/")||!workerDatabaseUrl)
      throw new TrafficPhotoWorkerErrorV516("PHOTO_WORKER_DB_UNAVAILABLE");
    this.pool=new pg.Pool({
      connectionString:workerDatabaseUrl,max:2,
      connectionTimeoutMillis:2500,statement_timeout:3500,query_timeout:4000,
      application_name:"jeriflow-v516-private-scanner"
    });
    this.pool.on("error",()=>{});
  }
  static async openPrivate(input:Readonly<{
    photoRoot:string;clamdSocketPath:string;workerDatabaseUrl:string;
  }>):Promise<TrafficPhotoVerificationWorkerV516>{
    const store=await TrafficCleanPhotoStoreV516.openPrivate(input.photoRoot);
    return new TrafficPhotoVerificationWorkerV516(store,input.clamdSocketPath,input.workerDatabaseUrl);
  }
  async close():Promise<void>{await this.pool.end();}

  /** Falha fechada se DSN for admin, o da API ou outra role sem direito limitado. */
  private async assertIsolatedWorker():Promise<void>{
    let result:pg.QueryResult<{
      allowed:boolean; privileged:boolean; apiMember:boolean;
    }>;
    try{
      result=await this.pool.query(`SELECT
        pg_has_role(current_user,'jeriflow_v516_scan_worker','USAGE') AS allowed,
        (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls
          FROM pg_roles WHERE rolname=current_user) AS privileged,
        pg_has_role(current_user,'jeriflow_app','MEMBER') AS "apiMember"`);
    }catch{throw new TrafficPhotoWorkerErrorV516("PHOTO_WORKER_DB_UNAVAILABLE");}
    if(result.rowCount!==1||result.rows[0].allowed!==true||
       result.rows[0].privileged!==false||result.rows[0].apiMember!==false)
      throw new TrafficPhotoWorkerErrorV516("PHOTO_WORKER_ROLE_DENIED");
  }

  /**
   * 1) autentica papel DB de worker; 2) lê arquivo normalizado privado;
   * 3) clamd varre bytes e retorna OK; 4) relê bytes e SHA;
   * 5) registra somente UUID + SHA no gate privado do PostgreSQL.
   * O protocolo será criado por OUTRA transação validada pela identidade.
   */
  async verifyAndRegister(ticket:CleanPhotoTicketV516, beforeRegister?:()=>Promise<void>):Promise<VerifiedPhotoGateTicketV516>{
    await this.assertIsolatedWorker();
    const verdict=await scanStoredTrafficPhotoV516(
      this.store,ticket,this.clamdSocketPath,5000);
    // Checagem adicional ANTES de registrar o gate de elegibilidade.
    const after=await this.store.readPrivate(ticket.municipalityId,ticket.photoId);
    if(!Buffer.isBuffer(after)||after.length!==ticket.byteLength||
       !sameSha(after,ticket.sha256))
      throw new TrafficPhotoWorkerErrorV516("PHOTO_WORKER_INTEGRITY_FAILURE");
    // O worker oficial revalida a versão carregada APÓS a varredura e
    // ANTES de marcar a mídia elegível na transação SQL.
    if(beforeRegister) await beforeRegister();
    try{
      await this.pool.query(
        "SELECT app.citizen_v516_record_scanned_media($1::uuid,$2::uuid,$3::text)",
        [ticket.municipalityId,ticket.photoId,ticket.sha256]);
    }catch{
      throw new TrafficPhotoWorkerErrorV516("PHOTO_WORKER_DB_UNAVAILABLE");
    }
    return Object.freeze({...verdict,registeredForProtocol:true as const});
  }
}
