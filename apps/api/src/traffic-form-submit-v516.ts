/**
 * JeriFlow V5.16 — envio PRIVADO e canônico do formulário de Trânsito.
 *
 * Autoridade exclusiva: ZIP V5.16 SHA-256
 * 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * cidadao-ai/index.html #trafficForm/submitTrafficForm() e
 * shared/jeriflow-audit-citizen.js submitTrafficForm().
 *
 * Esta classe NÃO é endpoint. main.ts permanece com HTTP desabilitado.
 * Não criar outro protocolo/ocorrência para Guarda ou SEMUS.
 */
import pg from "pg";
import {createHash,randomUUID} from "node:crypto";
import {sessionHash,uuid} from "./identity-primitives.ts";
import {resolveTrafficCitizenIdentityV516,
  type CitizenSessionResolverV516} from "./traffic-citizen-identity-v516.ts";
import {type TrafficPhotoMime,examineTrafficPhotoCandidate} from "./traffic-photo-candidate.ts";
import {type PrivateTrafficPhotoReceiptV516,
  type TrafficPhotoPrivatePipelineV516} from "./traffic-photo-private-pipeline-v516.ts";

const V516_TYPES=new Set([
  "Estacionamento irregular",
  "Veículo bloqueando acesso/garagem",
  "Veículo em área proibida",
  "Via parcialmente bloqueada",
  "Circulação irregular",
  "Transporte irregular",
  "Outro problema de trânsito",
]);
const PROTOCOL=/^JF-[0-9]{8}-[0-9]{6,}$/;
export type TrafficFormSubmissionV516=Readonly<{
  municipalityId:string;
  // Token vem do servidor de identidade, nunca de dados do formulário.
  sessionToken:string;
  title:string;
  location:string;
  plate?:string;
  description:string;
  // Somente o servidor recebe bytes do usuário e cria seu ticket privado.
  photoBytes:Uint8Array;
  photoMime?:TrafficPhotoMime;
}>;
export type TrafficProtocolSuccessV516=Readonly<{
  protocolId:string;
  status:"RECEBIDA";
  category:"Trânsito (SEMUS)";
  destination:"SEMUS / Guarda de trânsito";
  hasPhoto:true;
}>;
export class TrafficFormSubmissionErrorV516 extends Error {
  readonly code:"INVALID_TRAFFIC_FORM"|"TRAFFIC_SESSION_DENIED"|
    "TRAFFIC_SUBMISSION_REJECTED"|"TRAFFIC_SUBMISSION_UNAVAILABLE"|
    "TRAFFIC_SUBMISSION_UNCERTAIN"|"TRAFFIC_SUBMISSION_IN_PROGRESS";
  constructor(code:TrafficFormSubmissionErrorV516["code"]){super(code);this.code=code;}
}
function tidy(v:unknown,max:number):string {
  if(typeof v!=="string"||v.trim().length===0||
     v.trim().length>max||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v))
    throw new TrafficFormSubmissionErrorV516("INVALID_TRAFFIC_FORM");
  return v.trim();
}
function normalizeForm(input:TrafficFormSubmissionV516){
  try{
    const municipalityId=uuid(input.municipalityId);
    sessionHash(input.sessionToken);
    const title=tidy(input.title,120);
    if(!V516_TYPES.has(title))
      throw new TrafficFormSubmissionErrorV516("INVALID_TRAFFIC_FORM");
    const location=tidy(input.location,1000);
    const description=tidy(input.description,10000);
    const plate=typeof input.plate==="undefined"?"":input.plate;
    if(typeof plate!=="string"||plate.trim().length>8||
       /[\u0000-\u001f\u007f]/.test(plate))
      throw new TrafficFormSubmissionErrorV516("INVALID_TRAFFIC_FORM");
    // A placa continua opcional e em MAIÚSCULO como no HTML original.
    return {municipalityId,title,location,description,plate:plate.trim().toUpperCase()};
  }catch{
    throw new TrafficFormSubmissionErrorV516("INVALID_TRAFFIC_FORM");
  }
}
function complete(id:unknown):TrafficProtocolSuccessV516{
  if(typeof id!=="string"||!PROTOCOL.test(id))
    throw new TrafficFormSubmissionErrorV516("TRAFFIC_SUBMISSION_UNAVAILABLE");
  return Object.freeze({
    protocolId:id,status:"RECEBIDA" as const,
    category:"Trânsito (SEMUS)" as const,
    destination:"SEMUS / Guarda de trânsito" as const,hasPhoto:true as const,
  });
}
export class TrafficRegisteredFormServiceV516{
  private readonly pool:pg.Pool;
  private readonly pipeline:Pick<TrafficPhotoPrivatePipelineV516,"receiveRegistered">;
  private readonly resolveSession:CitizenSessionResolverV516;
  constructor(input:Readonly<{
    appDatabaseUrl:string;
    pipeline:Pick<TrafficPhotoPrivatePipelineV516,"receiveRegistered">;
    resolveSession:CitizenSessionResolverV516;
  }>){
    if(!input?.appDatabaseUrl||typeof input.appDatabaseUrl!=="string"||
       typeof input.pipeline?.receiveRegistered!=="function"||
       typeof input.resolveSession!=="function")
      throw new TrafficFormSubmissionErrorV516("TRAFFIC_SUBMISSION_UNAVAILABLE");
    this.pool=new pg.Pool({connectionString:input.appDatabaseUrl,max:2,
      connectionTimeoutMillis:2500,statement_timeout:4500,query_timeout:5000,
      application_name:"jeriflow-v516-traffic-canonical"});
    this.pool.on("error",()=>{});
    this.pipeline=input.pipeline;
    this.resolveSession=input.resolveSession;
  }
  async close(){await this.pool.end();}
  /** Autenticação ocorre ANTES de tocar os bytes/quarentena. */
  private async assertSession(mid:string,token:string):Promise<void>{
    try{
      const identity=await resolveTrafficCitizenIdentityV516(
        {municipalityId:mid,sessionToken:token},this.resolveSession);
      if(identity.registered!==true)
        throw new Error("REGISTERED_ONLY");
    }catch{throw new TrafficFormSubmissionErrorV516("TRAFFIC_SESSION_DENIED");}
  }
  /**
   * Verifica todos os campos originais; varre a fotografia no pipeline oficial;
   * só então chama o MESMO SQL citizen_v516_traffic_submit() existente.
   * O scanner não emite protocolo e esta transação consome a foto 1 vez.
   * Proibido repetir automaticamente quando houver falha incerta no DB.
   */
  async submitRegistered(input:TrafficFormSubmissionV516):Promise<TrafficProtocolSuccessV516>{
    const form=normalizeForm(input);
    await this.assertSession(form.municipalityId,input.sessionToken);
    // Fingerprint exclusivo do servidor: mesmos campos + MESMOS bytes
    // durante 24 h => mesma tentativa. Conta/município são separados pelo SQL.
    // Não há campo nem identificador extra na UI V5.16.
    let payloadSha256:string;
    try{
      examineTrafficPhotoCandidate(input.photoBytes,input.photoMime);
      payloadSha256=createHash("sha256").update(JSON.stringify({
        title:form.title,location:form.location,plate:form.plate,
        description:form.description,photoSha256:createHash("sha256")
          .update(input.photoBytes).digest("hex")
      })).digest("hex");
    }catch{throw new TrafficFormSubmissionErrorV516("INVALID_TRAFFIC_FORM");}
    const leaseId=randomUUID();
    const hash=sessionHash(input.sessionToken);
    let begin:pg.QueryResult<{
      outcome:string;photo_id:string|null;sha256:string|null;
      protocol_id:string|null;
    }>;
    try{
      begin=await this.pool.query(
        "SELECT * FROM app.citizen_v516_traffic_attempt_begin($1::uuid,$2::text,$3::text,$4::uuid)",
        [form.municipalityId,hash,payloadSha256,leaseId]);
    }catch{
      throw new TrafficFormSubmissionErrorV516("TRAFFIC_SUBMISSION_UNAVAILABLE");
    }
    if(begin.rowCount!==1)
      throw new TrafficFormSubmissionErrorV516("TRAFFIC_SUBMISSION_UNAVAILABLE");
    const attempt=begin.rows[0];
    if(attempt.outcome==="COMPLETE")return complete(attempt.protocol_id);
    if(attempt.outcome==="BUSY")
      throw new TrafficFormSubmissionErrorV516("TRAFFIC_SUBMISSION_IN_PROGRESS");
    let receipt:PrivateTrafficPhotoReceiptV516;
    if(attempt.outcome==="PHOTO_READY"&&attempt.photo_id&&attempt.sha256){
      // Usar a foto já varrida. O SQL confere dono/município/hash/consumo
      // no mesmo commit da denúncia, sem varrer a imagem de novo.
      receipt=Object.freeze({municipalityId:form.municipalityId,
        photoId:attempt.photo_id,sha256:attempt.sha256,
        registeredForProtocol:true,protocolCreated:false,
        evidenceApproved:false,publicUrl:null});
    }else if(attempt.outcome==="NEW"){
      receipt=await this.pipeline.receiveRegistered({
        municipalityId:form.municipalityId,sessionToken:input.sessionToken,
        bytes:input.photoBytes,suppliedMime:input.photoMime,
      });
      try{
        await this.pool.query(
          "SELECT app.citizen_v516_traffic_attempt_photo_ready("+
          "$1::uuid,$2::text,$3::text,$4::uuid,$5::uuid,$6::text)",
          [form.municipalityId,hash,payloadSha256,leaseId,
           uuid(receipt.photoId),receipt.sha256]);
      }catch{
        // Foto vinculada e elegível pode existir. Não apagar nem repetir.
        throw new TrafficFormSubmissionErrorV516("TRAFFIC_SUBMISSION_UNCERTAIN");
      }
    }else{
      throw new TrafficFormSubmissionErrorV516("TRAFFIC_SUBMISSION_UNAVAILABLE");
    }
    return this.submitPrivateReceipt(form,input.sessionToken,
      receipt,payloadSha256,leaseId);
  }
  /** Apenas o servidor pode chamar com recibo retornado pelo pipeline. */
  private async submitPrivateReceipt(form:ReturnType<typeof normalizeForm>,token:string,
    receipt:PrivateTrafficPhotoReceiptV516,payloadSha256:string,
    leaseId:string):Promise<TrafficProtocolSuccessV516>{
    if(!receipt||receipt.municipalityId!==form.municipalityId||
       receipt.registeredForProtocol!==true||
       receipt.protocolCreated!==false||receipt.evidenceApproved!==false||
       receipt.publicUrl!==null||!/^[a-f0-9]{64}$/.test(receipt.sha256))
      throw new TrafficFormSubmissionErrorV516("TRAFFIC_SUBMISSION_UNAVAILABLE");
    const hash=sessionHash(token);
    try{
      const result=await this.pool.query<{id:string}>(
        "SELECT app.citizen_v516_traffic_submit_once("+
        "$1::uuid,$2::text,$3::text,$4::uuid,"+
        "$5::text,$6::text,$7::text,$8::text) AS id",
        [form.municipalityId,hash,payloadSha256,uuid(leaseId),
         form.title,form.location,form.plate,form.description]);
      if(result.rowCount!==1)return await this.recoverAfterError(
        form.municipalityId,token,receipt);
      return complete(result.rows[0].id);
    }catch(error){
      if(error instanceof TrafficFormSubmissionErrorV516)throw error;
      const code=(error as {code?:string}).code;
      // Exceções definidas pelo SQL = rejeição comprovada; não dizer enviado.
      if(code==="JF001"||code==="JF003"||code==="JF004"||code==="JF005")
        throw new TrafficFormSubmissionErrorV516("TRAFFIC_SUBMISSION_REJECTED");
      return await this.recoverAfterError(form.municipalityId,token,receipt);
    }
  }
  /** Em falha de rede/ACK, consultar SQL que checa MESMA conta/foto/SHA.
   * NUNCA repetir INSERT: poderia gerar protocolo duplo.
   */
  private async recoverAfterError(mid:string,token:string,receipt:PrivateTrafficPhotoReceiptV516)
    :Promise<TrafficProtocolSuccessV516>{
    try{
      const recovered=await this.pool.query<{id:string|null}>(
        "SELECT app.citizen_v516_traffic_confirm_registered("+
        "$1::uuid,$2::text,$3::uuid,$4::text) AS id",
        [mid,sessionHash(token),uuid(receipt.photoId),receipt.sha256]);
      if(recovered.rowCount===1&&recovered.rows[0].id)
        return complete(recovered.rows[0].id);
    }catch{}
    // Foto permanece privada/reservada; orfandade precisa de reconciliação
    // transacional futura. Não alegar êxito nem reenviar automaticamente.
    throw new TrafficFormSubmissionErrorV516("TRAFFIC_SUBMISSION_UNCERTAIN");
  }
}
