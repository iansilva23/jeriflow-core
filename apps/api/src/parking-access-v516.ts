/**
 * V5.16 — chave privada de estacionamento do App Turista.
 * Referência: ZIP V5.16 SHA256
 * 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * admin-turismo/index.html makeParkingToken()/showAccessToken()/voucher;
 * turista/index.html validateParkingToken()/activateParkingToken()/recentes (5).
 *
 * NENHUMA rota pública é habilitada por este módulo. Token de capacidade deve
 * receber rate-limit distribuído/monitoramento no HTTP ANTES de exposição.
 * Nenhum documento TTS é concedido pela chave do estacionamento.
 */
import {randomBytes,createHash,createCipheriv,createDecipheriv} from "node:crypto";
import pg from "pg";
import {uuid,sessionHash} from "./identity-primitives.ts";

const TOKEN_ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TOKEN_PATTERN=/^JFPK-(?:[A-HJ-NP-Z2-9]{5}-){4}[A-HJ-NP-Z2-9]{6}$/;
const SHA=/^[a-f0-9]{64}$/;
export type TouristParkingAccessV516=Readonly<{
  valid:boolean;parking?:Readonly<{
    registrationId:string;plate:string;brand:string;model:string;
    hotel:string;entryAt:string;paidUntil:string;
    paidDays:number;totalPaidCents:number;
  }>;
}>;
export class ParkingAccessErrorV516 extends Error {
  readonly code:"PARKING_ACCESS_INVALID"|"PARKING_ACCESS_DENIED"|
    "PARKING_ACCESS_UNAVAILABLE"|"PARKING_ACCESS_INTEGRITY";
  constructor(code:ParkingAccessErrorV516["code"]){super(code);this.code=code;}
}
const sha=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
function makeToken(){
  const bytes=randomBytes(26);
  const chars=Array.from(bytes,b=>TOKEN_ALPHABET[b&31]).join("");
  const grouped=[chars.slice(0,5),chars.slice(5,10),chars.slice(10,15),
    chars.slice(15,20),chars.slice(20,26)].join("-");
  return "JFPK-"+grouped;
}
export class ParkingAccessServiceV516 {
  private readonly pool:pg.Pool;
  private readonly key:Buffer;
  constructor(input:Readonly<{databaseUrl:string;encryptionKey:Buffer}>){
    if(typeof input?.databaseUrl!=="string"||!input.databaseUrl||
       !Buffer.isBuffer(input.encryptionKey)||input.encryptionKey.length!==32)
      throw new ParkingAccessErrorV516("PARKING_ACCESS_UNAVAILABLE");
    this.pool=new pg.Pool({connectionString:input.databaseUrl,max:3,
      connectionTimeoutMillis:2500,statement_timeout:5000,query_timeout:5500,
      application_name:"jeriflow-v516-parking-access"});
    this.pool.on("error",()=>{});
    this.key=Buffer.from(input.encryptionKey);
  }
  async close(){await this.pool.end();this.key.fill(0);}
  /** Chamado somente no backend de confiança pelo ADM com MFA validada. */
  async issue(input:Readonly<{
    municipalityId:string;sessionToken:string;registrationId:string;
  }>):Promise<string>{
    const mid=uuid(input.municipalityId);
    const id=uuid(input.registrationId);
    const hash=sessionHash(input.sessionToken);
    const plain=makeToken(),digest=sha(plain),iv=randomBytes(12);
    const cipher=createCipheriv("aes-256-gcm",this.key,iv);
    cipher.setAAD(Buffer.from(mid+":"+id,"utf8"));
    const encrypted=Buffer.concat([cipher.update(plain,"utf8"),cipher.final()]);
    const tag=cipher.getAuthTag();
    try{
      await this.pool.query(
        "SELECT app.parking_v516_issue_access("+
        "$1::uuid,$2::text,$3::uuid,$4::text,$5::bytea,$6::bytea,$7::bytea)",
        [mid,hash,id,digest,encrypted,iv,tag]);
      return plain;
    }catch(e){
      const code=(e as {code?:string}).code;
      if(code==="JF003"||code==="JF004"||code==="JF005")
        throw new ParkingAccessErrorV516("PARKING_ACCESS_DENIED");
      throw new ParkingAccessErrorV516("PARKING_ACCESS_UNAVAILABLE");
    }
  }
  /** Reimpressão oficial: a chave armazenada só pode ser decifrada pela API
   * com chave AES privada E sessão do operador autorizada por PostgreSQL.
   */
  async reprint(input:Readonly<{
    municipalityId:string;sessionToken:string;registrationId:string;
  }>):Promise<string>{
    const mid=uuid(input.municipalityId);
    const id=uuid(input.registrationId);
    const hash=sessionHash(input.sessionToken);
    let data:{tokenHash:string;ciphertext:string;iv:string;tag:string};
    try{
      const r=await this.pool.query<{envelope:typeof data}>(
        "SELECT app.parking_v516_reprint_access("+
        "$1::uuid,$2::text,$3::uuid) AS envelope",[mid,hash,id]);
      if(r.rowCount!==1||!r.rows[0].envelope)
        throw new Error("MISSING");
      data=r.rows[0].envelope;
    }catch(e){
      if((e as {code?:string}).code?.startsWith("JF"))
        throw new ParkingAccessErrorV516("PARKING_ACCESS_DENIED");
      throw new ParkingAccessErrorV516("PARKING_ACCESS_UNAVAILABLE");
    }
    try{
      if(!SHA.test(data.tokenHash)||data.iv.length!==24||data.tag.length!==32)
        throw new Error("INTEGRITY");
      const decipher=createDecipheriv("aes-256-gcm",this.key,Buffer.from(data.iv,"hex"));
      decipher.setAAD(Buffer.from(mid+":"+id,"utf8"));
      decipher.setAuthTag(Buffer.from(data.tag,"hex"));
      const plain=Buffer.concat([decipher.update(Buffer.from(data.ciphertext,"hex")),decipher.final()])
        .toString("utf8");
      if(!TOKEN_PATTERN.test(plain)||sha(plain)!==data.tokenHash)
        throw new Error("INTEGRITY");
      return plain;
    }catch{
      throw new ParkingAccessErrorV516("PARKING_ACCESS_INTEGRITY");
    }
  }
  /** Validar uma chave apresentada pelo Turista; sem TTS/PII extra.
   * A elegibilidade depende de entrada física já iniciada e NÃO saída.
   */
  async validate(rawToken:string):Promise<TouristParkingAccessV516>{
    if(typeof rawToken!=="string")return {valid:false};
    const token=rawToken.trim().toUpperCase();
    if(!TOKEN_PATTERN.test(token))return {valid:false};
    try{
      const r=await this.pool.query<{response:TouristParkingAccessV516}>(
        "SELECT app.parking_v516_lookup_access($1::text) AS response",[sha(token)]);
      return r.rows[0]?.response?.valid===true?r.rows[0].response:{valid:false};
    }catch{
      throw new ParkingAccessErrorV516("PARKING_ACCESS_UNAVAILABLE");
    }
  }
  async revoke(input:Readonly<{
    municipalityId:string;sessionToken:string;registrationId:string;
    reason:string;
  }>):Promise<void>{
    const mid=uuid(input.municipalityId);
    const id=uuid(input.registrationId);
    const hash=sessionHash(input.sessionToken);
    if(typeof input.reason!=="string"||input.reason.trim().length<3||
       input.reason.trim().length>400)
      throw new ParkingAccessErrorV516("PARKING_ACCESS_INVALID");
    try{
      await this.pool.query(
        "SELECT app.parking_v516_revoke_access("+
        "$1::uuid,$2::text,$3::uuid,$4::text)",
        [mid,hash,id,input.reason.trim()]);
    }catch(e){
      if((e as {code?:string}).code?.startsWith("JF"))
        throw new ParkingAccessErrorV516("PARKING_ACCESS_DENIED");
      throw new ParkingAccessErrorV516("PARKING_ACCESS_UNAVAILABLE");
    }
  }
}
