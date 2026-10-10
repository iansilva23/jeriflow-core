/**
 * V5.16 — cadastro imediato e login/senha do App Cidadão, SEM e-mail obrigatório.
 * Fonte HTML: cidadao-ai/index.html citizenNorm(), citizenSignup(),
 * citizenLogin(), currentCitizen(), citizenModerationState().
 * Fonte ZIP SHA-256: 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 *
 * Esta é uma biblioteca de backend com PostgreSQL: não cria rota HTTP ou
 * protocolo, não substitui a identidade dos demais apps e não faz deploy.
 */
import pg from "pg";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { digest, sessionHash, uuid } from "./identity-primitives.ts";
import type { ServerCitizenAccountV516 } from "./traffic-citizen-identity-v516.ts";

export class CitizenAccountErrorV516 extends Error {
  readonly code: "INVALID_CITIZEN_INPUT" | "CITIZEN_LOGIN_INVALID" |
    "CITIZEN_LOGIN_IN_USE" | "CITIZEN_MODERATION_BLOCKED" |
    "CITIZEN_DATABASE_UNAVAILABLE" | "CITIZEN_AUTH_BUSY";
  constructor(code: CitizenAccountErrorV516["code"]) { super(code); this.code=code; }
}
export type CitizenSignupV516=Readonly<{
  municipalityId:string;name:string;birthDate:string;phone:string;address:string;
  login:string;password:string;confirmPassword:string;
}>;
export type CitizenLoginV516=Readonly<{
  municipalityId:string;login:string;password:string;
}>;
const PREFIX="scrypt$v1$131072$8$1$";
const DUMMY=PREFIX+"0".repeat(32)+"$"+"0".repeat(64);
const PASSWORD_RX=/^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/;
let working=0;
function error(code:CitizenAccountErrorV516["code"]):never{throw new CitizenAccountErrorV516(code);}
const clean=(s:unknown,max:number):string=>{
  if(typeof s!=="string"||!s.trim()||s.trim().length>max||/[\u0000-\u001f\u007f]/.test(s))
    return error("INVALID_CITIZEN_INPUT");
  return s.trim();
};
/** Idêntico ao citizenNorm() do HTML original (NFD, sem acentos). */
export function normalizeCitizenLoginV516(value:unknown):string {
  if(typeof value!=="string")return "";
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[^a-z0-9._-]+/g,".").replace(/^\.+|\.+$/g,"").replace(/\.+/g,".");
}
function password(value:unknown):string {
  // HTML exige 8, não 15 como a autenticação por email atual.
  // Teto de memória é proteção técnica; não vira nova exigência na tela.
  if(typeof value!=="string"||[...value].length<8||Buffer.byteLength(value)>512)
    return error("INVALID_CITIZEN_INPUT");
  return value;
}
function birth(value:unknown):string {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return error("INVALID_CITIZEN_INPUT");
  const date=new Date(value+"T00:00:00Z");
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)
    return error("INVALID_CITIZEN_INPUT");
  return value;
}
async function derive(pass:string,salt:Buffer):Promise<Buffer>{
  if(working>=2) return error("CITIZEN_AUTH_BUSY");
  working++;
  try{
    return await new Promise<Buffer>((resolve,reject)=>scrypt(pass,salt,32,
      {N:131072,r:8,p:1,maxmem:160*1024**2},(err,result)=>err?reject(err):resolve(result)));
  }finally{working--;}
}
export async function hashCitizenPasswordV516(value:unknown):Promise<string>{
  const pass=password(value),salt=randomBytes(16);
  return PREFIX+salt.toString("hex")+"$"+(await derive(pass,salt)).toString("hex");
}
export async function verifyCitizenPasswordV516(value:unknown,hash:unknown):Promise<boolean>{
  const pass=password(value),safe=typeof hash==="string"&&PASSWORD_RX.test(hash)?hash:DUMMY;
  const parts=safe.split("$");
  const test=await derive(pass,Buffer.from(parts[5],"hex"));
  return timingSafeEqual(test,Buffer.from(parts[6],"hex"))&&safe!==DUMMY;
}
export class CitizenAccountsV516 {
  private readonly pool:pg.Pool;
  constructor(databaseUrl:string){
    this.pool=new pg.Pool({connectionString:databaseUrl,max:4,connectionTimeoutMillis:2000,
      query_timeout:5000,statement_timeout:4500,application_name:"jeriflow-v516-citizen"});
    this.pool.on("error",()=>{}); // a broken idle client cannot crash the process.
  }
  async close():Promise<void>{await this.pool.end();}
  /** Cadastro imediato, emite token somente APÓS a transação confirmada. */
  async signup(input:CitizenSignupV516):Promise<Readonly<{citizenId:string;accessToken:string}>>{
    const mid=uuid(input.municipalityId),name=clean(input.name,120),
      date=birth(input.birthDate),phone=clean(input.phone,100),
      address=clean(input.address,300),login=normalizeCitizenLoginV516(input.login),
      pass=password(input.password);
    if(!login||login.length>64||input.confirmPassword!==pass)
      return error("INVALID_CITIZEN_INPUT");
    const encoded=await hashCitizenPasswordV516(pass);
    const token=randomBytes(32).toString("base64url");
    const client=await this.pool.connect().catch(()=>error("CITIZEN_DATABASE_UNAVAILABLE"));
    try {
      await client.query("BEGIN");
      const created=await client.query<{account_id:string;citizen_id:string}>(
        "SELECT * FROM app.citizen_v516_register($1,$2,$3::date,$4,$5,$6,$7)",
        [mid,name,date,phone,address,login,encoded]);
      if(created.rowCount!==1)throw new Error("REGISTRATION_NOT_PERSISTED");
      await client.query("SELECT app.citizen_v516_issue($1,$2,$3,$4)",
        [mid,created.rows[0].account_id,digest(token),encoded]);
      await client.query("COMMIT");
      return Object.freeze({citizenId:created.rows[0].citizen_id,accessToken:token});
    }catch(e){
      await client.query("ROLLBACK").catch(()=>{});
      if((e as {code?:string}).code==="23505")return error("CITIZEN_LOGIN_IN_USE");
      if((e as {message?:string}).message==="CITIZEN_MODERATION_BLOCKED")return error("CITIZEN_MODERATION_BLOCKED");
      return error("CITIZEN_DATABASE_UNAVAILABLE");
    }finally{client.release();}
  }
  /** Somente backend confiável: endpoint futuro PRECISA de rate-limit real. */
  async login(input:CitizenLoginV516):Promise<Readonly<{accessToken:string}>>{
    const mid=uuid(input.municipalityId),login=normalizeCitizenLoginV516(input.login),
      pass=password(input.password);
    if(!login||login.length>64)return error("INVALID_CITIZEN_INPUT");
    try {
      const found=await this.pool.query<{account_id:string;password_hash:string}>(
        "SELECT * FROM app.citizen_v516_credential($1,$2)",[mid,login]);
      const row=found.rows[0];
      const ok=await verifyCitizenPasswordV516(pass,row?.password_hash);
      if(!ok||!row)return error("CITIZEN_LOGIN_INVALID");
      const token=randomBytes(32).toString("base64url");
      try {
        await this.pool.query("SELECT app.citizen_v516_issue($1,$2,$3,$4)",
          [mid,row.account_id,digest(token),row.password_hash]);
      }catch{return error("CITIZEN_LOGIN_INVALID");}
      return Object.freeze({accessToken:token});
    }catch(e){
      if(e instanceof CitizenAccountErrorV516)throw e;
      return error("CITIZEN_DATABASE_UNAVAILABLE");
    }
  }
  /** Usado pelo CitizenSessionResolverV516: sessão real, tenant e moderação atuais. */
  async resolveSession(token:string,municipalityId:string):Promise<ServerCitizenAccountV516|null>{
    let hash:string,mid:string;
    try{hash=sessionHash(token);mid=uuid(municipalityId);}
    catch{return null;}
    try{
      const result=await this.pool.query<ServerCitizenAccountV516>(
        "SELECT * FROM app.citizen_v516_resolve($1,$2)",[mid,hash]);
      return result.rows[0]??null;
    }catch{return error("CITIZEN_DATABASE_UNAVAILABLE");}
  }
  async logout(token:string):Promise<void>{
    let hash:string;try{hash=sessionHash(token);}catch{return;}
    try{await this.pool.query("SELECT app.citizen_v516_logout($1)",[hash]);}
    catch{return error("CITIZEN_DATABASE_UNAVAILABLE");}
  }
}
