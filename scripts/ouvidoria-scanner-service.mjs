// Executor de homologacao/implantacao: conta de DB dedicada, SEM owner.
import pg from "pg";
import {readFileSync,lstatSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {readIdentityKey} from "../apps/api/src/identity-security.ts";
import {checkOfficialSignatures} from "./clamav-freshness.mjs";
import {scanOnce} from "./ouvidoria-scan-once.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export function checkedSecret(path){
  if(typeof path!=="string"||!path.startsWith("/")||path.includes(".."))
    throw Error("SCANNER_SECRET_FILE_REQUIRED");
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o077||
    (process.getuid&&stat.uid!==process.getuid()))throw Error("SCANNER_SECRET_PERMISSIONS");
  const value=readFileSync(path,"utf8").trim();
  if(!value||value.length>512)throw Error("SCANNER_SECRET_INVALID");
  return value;
}
export function scannerConfig(env=process.env){
  if(env.JERIFLOW_SCANNER_ENABLE!=="1")throw Error("SCANNER_DISABLED");
  if(!/^[a-z_][a-z0-9_]{2,62}$/.test(env.JERIFLOW_SCANNER_DBUSER??"")||
    ["jeriflow_owner","jeriflow_app","postgres","jeriflow_scanner"].includes(env.JERIFLOW_SCANNER_DBUSER))
    throw Error("SCANNER_RESTRICTED_LOGIN_REQUIRED");
  const port=Number(env.JERIFLOW_SCANNER_DBPORT??5432);
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error("SCANNER_DBPORT_INVALID");
  const database=env.JERIFLOW_SCANNER_DBNAME;
  const host=env.JERIFLOW_SCANNER_DBHOST;
  if(!database||!/^[a-z0-9_-]{1,63}$/.test(database)||!host||
    /[\s/:]/.test(host))throw Error("SCANNER_DATABASE_INVALID");
  const socket=env.JERIFLOW_CLAMD_SOCKET;
  const signatures=env.JERIFLOW_CLAMAV_DB;
  if(!socket?.startsWith("/")||socket.includes("..")||
     !signatures?.startsWith("/")||signatures.includes(".."))
     throw Error("SCANNER_LOCAL_CLAMAV_REQUIRED");
  return {port,database,host,user:env.JERIFLOW_SCANNER_DBUSER,
    passwordFile:env.JERIFLOW_SCANNER_DB_PASSWORD_FILE, socket,signatures};
}
export async function assertScannerPrivileges(client) {
  const check=await client.query(`SELECT
    has_table_privilege(current_user,'app.ouvidoria_attachments','SELECT') AS attachment_read,
    has_table_privilege(current_user,'app.ouvidoria_attachments','UPDATE') AS attachment_update,
    has_table_privilege(current_user,'app.ouvidoria_attachment_scan_events','INSERT') AS audit_insert,
    has_function_privilege(current_user,'app.ouvidoria_scan_claim(uuid)','EXECUTE') AS can_claim,
    has_function_privilege(current_user,'app.ouvidoria_scan_finish(uuid,uuid,text,text)','EXECUTE') AS can_finish`);
  const p=check.rows[0];
  if(!p||p.attachment_read||p.attachment_update||p.audit_insert||!p.can_claim||!p.can_finish)
    throw Error("SCANNER_PRIVILEGES_UNSAFE");
  return true;
}
export async function operateOnce(client,key,config,options={}){
  const signatures=await checkOfficialSignatures(config.signatures,options);
  const result=await scanOnce({owner:client,identityKey:key,
    socketPath:config.socket,scannerVersion:"clamav-"+signatures.version});
  return {processed:result.processed,status:result.status??"empty",
    signatureVersion:signatures.version,
    signatureAgeHours:Math.round(signatures.ageHours*10)/10};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let db,key;
  try{
    const cfg=scannerConfig();
    db=new pg.Client({host:cfg.host,port:cfg.port,database:cfg.database,
      user:cfg.user,password:checkedSecret(cfg.passwordFile),
      connectionTimeoutMillis:4000,statement_timeout:12000,
      query_timeout:15000});
    db.on("error",()=>{process.exitCode=1});
    key=readIdentityKey(root);
    await db.connect();
    await assertScannerPrivileges(db);
    const once=process.argv.includes("--once");
    do{
      try {
        const r=await operateOnce(db,key,cfg);
        console.log(JSON.stringify({status:r.status,processed:r.processed,
          signatureVersion:r.signatureVersion,signatureAgeHours:r.signatureAgeHours}));
      }catch{
        // Nao retirar da fila se o antivirus/bases nao estiverem saudaveis.
        console.error("SCANNER_UNAVAILABLE_QUARANTINE_RETAINED");
        process.exitCode=1;
        if(once)break;
      }
      if(!once)await delay(15000);
    }while(!once);
  }catch{
    console.error("SCANNER_CONFIGURATION_OR_DB_UNAVAILABLE");
    process.exitCode=1;
  }finally{
    key?.fill(0);
    await db?.end().catch(()=>{});
  }
}
