/**
 * V5.16 — Verificação OPERACIONAL do antivírus de foto de trânsito.
 * Base única: cidadao-ai/index.html #trafficForm e shared/jeriflow-audit-citizen.js.
 * ZIP SHA-256: 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
 * A versão VERSION de clamd verifica apenas a daily, não main/bytecode.
 */
import {createConnection} from "node:net";
import {isAbsolute,join} from "node:path";
import {lstat} from "node:fs/promises";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import {setTimeout as sleep} from "node:timers/promises";
import {checkOfficialClamAVDatabasesV516} from "./clamav-official-readiness-v516.ts";

const execFileAsync=promisify(execFile);
export class ClamdLiveDatabaseErrorV516 extends Error {
  readonly code:"CLAMD_NOT_CONFIGURED"|"CLAMD_UNAVAILABLE"|
    "CLAMD_UNVERIFIED_REPLY"|"CLAMD_DATABASE_MISMATCH"|
    "CLAMD_RELOAD_REJECTED"|"CLAMD_RELOAD_TIMEOUT"|"CLAMD_DAILY_UNVERIFIED";
  constructor(code:ClamdLiveDatabaseErrorV516["code"]){super(code);this.code=code;}
}
export async function commandClamdV516(path:string,command:"VERSION"|"RELOAD"|"PING",timeout=5000):Promise<string>{
  if(typeof path!=="string"||!isAbsolute(path)||path.includes("\0")||
     !Number.isInteger(timeout)||timeout<1||timeout>30000)
    throw new ClamdLiveDatabaseErrorV516("CLAMD_NOT_CONFIGURED");
  return await new Promise<string>((resolve,reject)=>{
    const socket=createConnection({path});
    let settled=false,buf=Buffer.alloc(0);
    const end=(error?:ClamdLiveDatabaseErrorV516,value?:string)=>{
      if(settled)return;settled=true;socket.destroy();
      if(error)reject(error);else resolve(value??"");
    };
    socket.setTimeout(timeout);
    socket.on("timeout",()=>end(new ClamdLiveDatabaseErrorV516("CLAMD_UNAVAILABLE")));
    socket.on("error",()=>end(new ClamdLiveDatabaseErrorV516("CLAMD_UNAVAILABLE")));
    socket.on("end",()=>end(new ClamdLiveDatabaseErrorV516("CLAMD_UNVERIFIED_REPLY")));
    socket.on("connect",()=>socket.write(Buffer.from("z"+command+"\0","utf8")));
    socket.on("data",chunk=>{
      buf=Buffer.concat([buf,chunk]);
      if(buf.length>4096)return end(new ClamdLiveDatabaseErrorV516("CLAMD_UNVERIFIED_REPLY"));
      const n=buf.indexOf(0);
      if(n<0)return;
      if(n!==buf.length-1)return end(new ClamdLiveDatabaseErrorV516("CLAMD_UNVERIFIED_REPLY"));
      end(undefined,buf.subarray(0,n).toString("utf8"));
    });
  });
}
/** ClamAV <engine>/<database daily version>/<date>. */
export function parseClamdDailyVersionV516(message:string):number{
  if(typeof message!=="string"||message.length>512||/[\u0000-\u001f]/.test(message))
    throw new ClamdLiveDatabaseErrorV516("CLAMD_UNVERIFIED_REPLY");
  const m=/^ClamAV [A-Za-z0-9.+_-]+\/([0-9]{1,10})\/[^/]{4,120}$/.exec(message.trim());
  const v=m?Number(m[1]):NaN;
  if(!Number.isSafeInteger(v)||v<1)
    throw new ClamdLiveDatabaseErrorV516("CLAMD_UNVERIFIED_REPLY");
  return v;
}
export function parseSignedDailyVersionV516(info:string):number{
  if(typeof info!=="string"||info.length>32000||
     !/(?:^|\n)Verification OK\.?(?:\r?\n|$)/.test(info))
    throw new ClamdLiveDatabaseErrorV516("CLAMD_DAILY_UNVERIFIED");
  const m=/(?:^|\n)Version:\s*([0-9]{1,10})\s*(?:\r?\n|$)/.exec(info);
  const v=m?Number(m[1]):NaN;
  if(!Number.isSafeInteger(v)||v<1)
    throw new ClamdLiveDatabaseErrorV516("CLAMD_DAILY_UNVERIFIED");
  return v;
}
async function officialDailyVersion(dir:string):Promise<number>{
  if(typeof dir!=="string"||!isAbsolute(dir)||dir.includes("\0"))
    throw new ClamdLiveDatabaseErrorV516("CLAMD_DAILY_UNVERIFIED");
  await checkOfficialClamAVDatabasesV516(dir);
  let path:string|undefined;
  for(const name of ["daily.cvd","daily.cld"]){
    const candidate=join(dir,name);
    try{
      const s=await lstat(candidate);
      if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)
        throw new ClamdLiveDatabaseErrorV516("CLAMD_DAILY_UNVERIFIED");
      path=candidate;break;
    }catch(e){
      if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;
    }
  }
  if(!path)throw new ClamdLiveDatabaseErrorV516("CLAMD_DAILY_UNVERIFIED");
  let info:string;
  try{
    const result=await execFileAsync("/usr/bin/sigtool",["--info",path],
      {timeout:12000,maxBuffer:32000,shell:false});
    info=result.stdout;
  }catch{throw new ClamdLiveDatabaseErrorV516("CLAMD_DAILY_UNVERIFIED");}
  return parseSignedDailyVersionV516(info);
}
export async function assertClamdLoadsOfficialDailyV516(input:Readonly<{
  socketPath:string;databaseDirectory:string;
}>):Promise<Readonly<{dailyVersion:number;daemonVerified:true;evidenceApproved:false}>>{
  const expected=await officialDailyVersion(input.databaseDirectory);
  const actual=parseClamdDailyVersionV516(await commandClamdV516(input.socketPath,"VERSION"));
  if(actual!==expected)throw new ClamdLiveDatabaseErrorV516("CLAMD_DATABASE_MISMATCH");
  return Object.freeze({dailyVersion:actual,daemonVerified:true,evidenceApproved:false});
}
/**
 * Operação exclusivamente administrativa, fora da rota de foto.
 * RELOADING pode ser assíncrono. Só retorna após VERSION coincidir.
 */
export async function reloadClamdAndVerifyV516(input:Readonly<{
  socketPath:string;databaseDirectory:string;
}>,maxAttempts=24,intervalMs=1000):Promise<Readonly<{dailyVersion:number;daemonVerified:true}>>{
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>120||
     !Number.isInteger(intervalMs)||intervalMs<1||intervalMs>10000)
    throw new ClamdLiveDatabaseErrorV516("CLAMD_NOT_CONFIGURED");
  const expected=await officialDailyVersion(input.databaseDirectory);
  const reply=await commandClamdV516(input.socketPath,"RELOAD");
  if(reply!=="RELOADING")
    throw new ClamdLiveDatabaseErrorV516("CLAMD_RELOAD_REJECTED");
  for(let i=0;i<maxAttempts;i++){
    if(i>0)await sleep(intervalMs);
    try{
      const actual=parseClamdDailyVersionV516(
        await commandClamdV516(input.socketPath,"VERSION"));
      if(actual===expected){
        await checkOfficialClamAVDatabasesV516(input.databaseDirectory);
        return Object.freeze({dailyVersion:actual,daemonVerified:true});
      }
    }catch(e){
      if(!(e instanceof ClamdLiveDatabaseErrorV516)||e.code==="CLAMD_NOT_CONFIGURED")
        throw e;
    }
  }
  throw new ClamdLiveDatabaseErrorV516("CLAMD_RELOAD_TIMEOUT");
}
