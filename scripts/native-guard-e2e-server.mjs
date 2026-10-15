/** Servidor de homologação Android SOMENTE no runner descartável do GitHub.
 * Cria identidades/protocolos FICTÍCIOS em PostgreSQL e Redis locais.
 * Não modifica main.ts, não fornece rota externa, não usa dados de produção.
 */
import assert from "node:assert/strict";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {writeFileSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import pg from "pg";
import {migrateIdentity,localIdentityConfiguration,ownerClient} from "./identity-database.mjs";
import {provisionIdentity} from "./identity-provision.mjs";
import {readIdentityKey} from "../apps/api/src/identity-security.ts";
import {IdentityService} from "../apps/api/src/identity.ts";
import {CitizenAccountsV516} from "../apps/api/src/citizen-accounts-v516.ts";
import {GuardTrafficReadServiceV516} from "../apps/api/src/guard-traffic-read-http-v516.ts";
import {GuardMutationServiceV516} from "../apps/api/src/guard-traffic-mutation-http-v516.ts";
import {GuardShiftServiceV516} from "../apps/api/src/guard-shift-service-v516.ts";
import {createApp} from "../apps/api/src/server.ts";

assert(process.env.GITHUB_ACTIONS==="true");
assert(
 (process.env.JF_NATIVE_GUARDA_SHIFT_UI_SMOKE==="1"&&
   process.env.GITHUB_REF==="refs/heads/feature/v516-guarda-shift-android-e2e-20261015")
 ||(process.env.JF_NATIVE_GUARDA_SHIFT_UI_SMOKE!=="1"&&
   process.env.GITHUB_REF==="refs/heads/feature/v516-guarda-native-login-e2e-20261012")
);
assert(process.env.NODE_ENV!=="production");
assert(process.env.RUNNER_TEMP);
assert(process.env.JF_GUARDA_E2E_SERVER==="1");
const root=fileURLToPath(new URL("..",import.meta.url));
const config=localIdentityConfiguration(root);
await migrateIdentity(root);
const id=randomUUID();
const email="guarda-e2e-"+id+"@example.invalid";
const password=randomBytes(24).toString("hex");
const municipalityName="Município Fictício Integrado";
const provision=await provisionIdentity(root,{
 email,password,displayName:"Guarda Fictício Integrado",
 municipalities:[{slug:"guard-e2e-"+id,displayName:municipalityName,roles:["guarda"]}]
});
const municipalityId=provision.municipalities[0].id;
const owner=ownerClient(root);
const app=new pg.Client({connectionString:config.databaseUrl});
const citizen=new CitizenAccountsV516(config.databaseUrl);
const identity=new IdentityService(config,{
 encryptionKey:readIdentityKey(root),throttleNamespace:"jeriflow:test:"+id+":login"
});
const read=new GuardTrafficReadServiceV516(config.databaseUrl);
const mutate=new GuardMutationServiceV516(config.databaseUrl);
const shift=process.env.JF_NATIVE_GUARDA_SHIFT_UI_SMOKE==="1"
 ? new GuardShiftServiceV516(config.databaseUrl):undefined;
const server=createApp(undefined,identity,undefined,read,mutate,shift);
const sha=x=>createHash("sha256").update(x).digest("hex");
const migrations=[
 "004-citizen-v516.sql","005-citizen-v516-traffic-protocol.sql",
 "006-citizen-v516-scanned-photo-worker.sql","007-citizen-v516-traffic-photo-owner.sql",
 "008-citizen-v516-traffic-confirm-ack.sql","009-citizen-v516-traffic-idempotency.sql",
 "010-citizen-v516-photo-reconciliation-preview.sql",
 "020-parking-v516-register-extensions-exit.sql","021-parking-v516-admin-queries.sql",
 "022-parking-v516-access-tokens.sql","023-citizen-v516-guard-queue.sql",
 "024-citizen-v516-guard-service.sql","025-citizen-v516-guard-shift.sql",
 "026-citizen-v516-guard-support.sql","027-citizen-v516-guard-flags.sql",
 "028-citizen-v516-flag-contestation.sql"
];
let closing=false;
async function shutdown(){
 if(closing)return;closing=true;
 if(server.listening){server.closeAllConnections();await new Promise(done=>server.close(done));}
 await Promise.allSettled([owner.end(),app.end(),citizen.close(),identity.close(),read.close(),mutate.close(),...(shift?[shift.close()]:[])]);
}
process.once("SIGTERM",()=>void shutdown());
process.once("SIGINT",()=>void shutdown());
try{
 await owner.connect();
 for(const name of migrations){
  await owner.query(readFileSync(new URL("../infra/migrations/"+name,import.meta.url),"utf8"));
 }
 await owner.query("UPDATE app.identity_users SET email_verified_at=clock_timestamp() WHERE id=$1",[provision.userId]);
 await app.connect();
 const created=await citizen.signup({
  municipalityId,name:"Cidadã Fictícia",birthDate:"1993-10-10",
  phone:"(88) 90000-0000",address:"Rua Fictícia",
  login:"citizen."+id,password:"SenhaFicticia12345",confirmPassword:"SenhaFicticia12345"
 });
 const account=(await owner.query("SELECT id FROM app.citizen_v516_accounts WHERE municipality_id=$1 AND citizen_id=$2",
  [municipalityId,created.citizenId])).rows[0]?.id;
 assert(account);
 const photoId=randomUUID(),photoSha=sha("synthetic-guard-android-e2e-"+id);
 await owner.query("INSERT INTO app.citizen_v516_traffic_photo_owners(photo_id,municipality_id,citizen_account_id,sha256) VALUES($1,$2,$3,$4)",
  [photoId,municipalityId,account,photoSha]);
 await owner.query("INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",
  [photoId,municipalityId,photoSha]);
 const protocolId=(await app.query(
  "SELECT app.citizen_v516_traffic_submit($1::uuid,$2::text,NULL::text,NULL::text,NULL::date,NULL::text,$3::text,$4::text,$5::text,$6::text,$7::uuid,$8::text) AS id",
  [municipalityId,sha(created.accessToken),"Transporte irregular","Rua Fictícia",
   "ABC1234","Denúncia fictícia para teste Android",photoId,photoSha])).rows[0].id;
 assert.match(protocolId,/^JF-\d{8}-\d{6}$/);
 await new Promise((done,fail)=>server.once("error",fail).listen(3001,"127.0.0.1",done));
 const path=join(process.env.RUNNER_TEMP,"jeriflow-guard-e2e-fixture.json");
 writeFileSync(path,JSON.stringify({email,password,municipalityName,municipalityId,protocolId,guardUserId:provision.userId}),{flag:"wx",mode:0o600});
 console.log("GUARDA_E2E_READY (somente localhost; dados fictícios; credenciais não registradas)");
}catch(error){
 await shutdown();
 // Falha sem exibir dados da conta nem variáveis da conexão.
 console.error("GUARDA_E2E_SETUP_FAILED",error?.code??error?.message?.replaceAll(email,"[synthetic]")??"unknown");
 process.exitCode=1;
}
