/**
 * V5.16 — reserva invisível da fotografia ao Cidadão logado.
 * Fonte única: cidadao-ai/index.html / shared/jeriflow-audit-citizen.js
 * SHA256 ZIP: 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 *
 * A foto é originária do armazenamento privado, não do cliente HTTP.
 * A reserva precisa ser feita ANTES de registrar a foto no gate do scanner;
 * sozinha NUNCA cria protocolo, nunca aprova imagem nem retorna URLs.
 *
 * Não ligado à rota de upload: a PR30 mantém 503 por padrão.
 */
import pg from "pg";
import {sessionHash,uuid} from "./identity-primitives.ts";
import type {CleanPhotoTicketV516} from "./traffic-photo-clean-store-v516.ts";

const SHA=/^[a-f0-9]{64}$/;
export class TrafficPhotoOwnerErrorV516 extends Error {
  readonly code:"TRAFFIC_PHOTO_OWNER_INVALID"|"TRAFFIC_PHOTO_OWNER_DENIED"|
    "TRAFFIC_PHOTO_OWNER_CONFLICT"|"TRAFFIC_PHOTO_OWNER_DB_UNAVAILABLE";
  constructor(code:TrafficPhotoOwnerErrorV516["code"]){super(code);this.code=code;}
}
export class TrafficPhotoOwnershipV516 {
  private readonly pool:pg.Pool;
  constructor(databaseUrl:string){
    if(typeof databaseUrl!=="string"||!databaseUrl)
      throw new TrafficPhotoOwnerErrorV516("TRAFFIC_PHOTO_OWNER_DB_UNAVAILABLE");
    this.pool=new pg.Pool({connectionString:databaseUrl,max:2,
      connectionTimeoutMillis:2500,query_timeout:5000,statement_timeout:4500,
      application_name:"jeriflow-v516-traffic-photo-owner"});
    this.pool.on("error",()=>{});
  }
  async close(){await this.pool.end();}
  async reserveRegistered(input:Readonly<{
    municipalityId:string;
    // Somente token de sessão obtido de header Bearer autenticado.
    sessionToken:string;
    // Ticket emitido pelo servidor APÓS normalização e store privado.
    ticket:CleanPhotoTicketV516;
  }>):Promise<void>{
    let mid:string,tokenHash:string;
    const t=input.ticket;
    try{
      mid=uuid(input.municipalityId);
      tokenHash=sessionHash(input.sessionToken);
      if(!t||uuid(t.municipalityId)!==mid||
        !uuid(t.photoId)||!SHA.test(t.sha256)||
        t.stored!==true||t.normalized!==true||t.metadataRemoved!==true||
        t.malwareScanned!==false||t.evidenceApproved!==false||
        t.protocolCreated!==false||t.mime!=="image/webp")
        throw new Error("INVALID_PRIVATE_TICKET");
    }catch{throw new TrafficPhotoOwnerErrorV516("TRAFFIC_PHOTO_OWNER_INVALID");}
    try{
      await this.pool.query(
        "SELECT app.citizen_v516_reserve_traffic_photo($1::uuid,$2::text,$3::uuid,$4::text)",
        [mid,tokenHash,t.photoId,t.sha256]);
    }catch(error){
      const code=(error as {code?:string}).code;
      if(code==="JF003")
        throw new TrafficPhotoOwnerErrorV516("TRAFFIC_PHOTO_OWNER_DENIED");
      if(code==="23505")
        throw new TrafficPhotoOwnerErrorV516("TRAFFIC_PHOTO_OWNER_CONFLICT");
      throw new TrafficPhotoOwnerErrorV516("TRAFFIC_PHOTO_OWNER_DB_UNAVAILABLE");
    }
  }
}
