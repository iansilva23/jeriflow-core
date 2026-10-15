import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
import {ownerClient,migrateIdentity,localIdentityConfiguration} from "../../scripts/identity-database.mjs";
import {provisionIdentity} from "../../scripts/identity-provision.mjs";
import {readIdentityKey} from "../../apps/api/src/identity-security.ts";
import {IdentityService} from "../../apps/api/src/identity.ts";
import {CitizenAccountsV516} from "../../apps/api/src/citizen-accounts-v516.ts";
import {GuardTrafficReadServiceV516} from "../../apps/api/src/guard-traffic-read-http-v516.ts";
import {GuardMutationServiceV516} from "../../apps/api/src/guard-traffic-mutation-http-v516.ts";
import {GuardShiftServiceV516} from "../../apps/api/src/guard-shift-service-v516.ts";
import {GuardSupportServiceV516} from "../../apps/api/src/guard-support-service-v516.ts";
import {createApp} from "../../apps/api/src/server.ts";
import {AuthController} from "../../packages/auth/controller.ts";
import {bearerTransport} from "../../packages/auth/client.ts";
import {guardAuthorizedActionsV516,guardEligibleMunicipalitiesV516} from "../../apps/guarda/guard-access-gate-v516.ts";

const sha=value=>createHash("sha256").update(value).digest("hex");
const vault=()=>({value:null,async get(){return this.value;},async set(v){this.value=v;},async remove(){this.value=null;}});

test("Guarda V5.16: login real, autorização, atendimento, finalização, logout e bloqueio",{timeout:180000},async()=>{
 assert.equal(process.env.GITHUB_ACTIONS,"true");
 assert.notEqual(process.env.NODE_ENV,"production");
 const root=fileURLToPath(new URL("../..",import.meta.url));
 const config=localIdentityConfiguration(root);
 await migrateIdentity(root);
 const suffix=randomUUID();
 const password=randomBytes(24).toString("hex");
 const touristPassword=randomBytes(24).toString("hex");
 const login="guard-"+suffix+"@example.invalid";
 const touristEmail="tourist-"+suffix+"@example.invalid";
 const displayName="Município Fictício Integrado";
 const slug="guard-native-"+suffix;
 const guard=await provisionIdentity(root,{email:login,password,displayName:"Guarda Fictício Integrado",
  municipalities:[{slug,displayName,roles:["guarda"]}]});
 const municipalityId=guard.municipalities[0].id;
 const tourist=await provisionIdentity(root,{email:touristEmail,password:touristPassword,
  displayName:"Turista Fictício",municipalities:[{slug,displayName,roles:["turista"]}]});
 const owner=ownerClient(root),app=new pg.Client({connectionString:config.databaseUrl});
 const citizenAccounts=new CitizenAccountsV516(config.databaseUrl);
 const identity=new IdentityService(config,{encryptionKey:readIdentityKey(root),throttleNamespace:"jeriflow:test:"+suffix+":login"});
 const read=new GuardTrafficReadServiceV516(config.databaseUrl);
 const mutate=new GuardMutationServiceV516(config.databaseUrl);
 const shift=new GuardShiftServiceV516(config.databaseUrl);
 const support=new GuardSupportServiceV516(config.databaseUrl);
 const server=createApp(undefined,identity,undefined,read,mutate,shift,support);
 try{
  await owner.connect();
  // O migrador de identidade cuida somente de 001–003. A fixture precisa
  // montar a cadeia operacional original V5.16 no banco EFÊMERO, sem mudar
  // migrador global, dados existentes ou produção.
  const originalGuardMigrations=[
   "004-citizen-v516.sql","005-citizen-v516-traffic-protocol.sql",
   "006-citizen-v516-scanned-photo-worker.sql","007-citizen-v516-traffic-photo-owner.sql",
   "008-citizen-v516-traffic-confirm-ack.sql","009-citizen-v516-traffic-idempotency.sql",
   "010-citizen-v516-photo-reconciliation-preview.sql",
   "020-parking-v516-register-extensions-exit.sql",
   "021-parking-v516-admin-queries.sql","022-parking-v516-access-tokens.sql",
   "023-citizen-v516-guard-queue.sql","024-citizen-v516-guard-service.sql",
   "025-citizen-v516-guard-shift.sql","026-citizen-v516-guard-support.sql",
   "027-citizen-v516-guard-flags.sql","028-citizen-v516-flag-contestation.sql"
  ];
  for(const name of originalGuardMigrations)
   await owner.query(readFileSync(new URL("../../infra/migrations/"+name,import.meta.url),"utf8"));
  await owner.query("UPDATE app.identity_users SET email_verified_at=clock_timestamp() WHERE id IN ($1,$2)",
   [guard.userId,tourist.userId]);
  await app.connect();
  const citizen=await citizenAccounts.signup({
   municipalityId,name:"Cidadã Fictícia para Atendimento",birthDate:"1993-10-10",
   phone:"(88) 90000-0000",address:"Rua Fictícia",login:"guard.login."+suffix,
   password:"SenhaFicticia12345",confirmPassword:"SenhaFicticia12345"
  });
  const account=(await owner.query("SELECT id FROM app.citizen_v516_accounts WHERE municipality_id=$1 AND citizen_id=$2",
   [municipalityId,citizen.citizenId])).rows[0].id;
  assert(account);
  const photoId=randomUUID(),photoSha=sha("fixture-guard-login-"+suffix);
  await owner.query("INSERT INTO app.citizen_v516_traffic_photo_owners(photo_id,municipality_id,citizen_account_id,sha256) VALUES($1,$2,$3,$4)",
   [photoId,municipalityId,account,photoSha]);
  await owner.query("INSERT INTO app.citizen_v516_verified_traffic_media(photo_id,municipality_id,sha256) VALUES($1,$2,$3)",
   [photoId,municipalityId,photoSha]);
  const protocol=(await app.query(
   "SELECT app.citizen_v516_traffic_submit($1::uuid,$2::text,NULL::text,NULL::text,NULL::date,NULL::text,$3::text,$4::text,$5::text,$6::text,$7::uuid,$8::text) AS id",
   [municipalityId,sha(citizen.accessToken),"Transporte irregular",
    "Rua Fictícia de Homologação","ABC1234","Ocorrência sintética para login verdadeiro",
    photoId,photoSha])).rows[0].id;
  assert.match(protocol,/^JF-[0-9]{8}-[0-9]{6}$/);
  await new Promise((ok,fail)=>server.once("error",fail).listen(0,"127.0.0.1",ok));
  const addr=server.address();assert(addr&&typeof addr!=="string");
  const base="http://127.0.0.1:"+addr.port;
  const secureStore=vault(),transport=bearerTransport(()=>base,secureStore);
  const controller=new AuthController(transport);
  await controller.refresh();
  assert.equal(controller.snapshot().mode,"login");
  assert.equal(secureStore.value,null);
  await controller.login(login,password);
  assert.equal(controller.snapshot().mode,"home");
  const context=controller.snapshot().context;
  assert(context);
  assert.equal(context.user.id,guard.userId);
  assert.equal(context.security.nextStep,"ready");
  assert(guardEligibleMunicipalitiesV516(context).some(m=>m.id===municipalityId));
  assert(secureStore.value,"A sessão deve estar no cofre de teste");
  assert(!JSON.stringify(context).includes(secureStore.value),"Token não entra no contexto");
  const actions=await guardAuthorizedActionsV516(transport,context,municipalityId,randomUUID);
  await assert.rejects(guardAuthorizedActionsV516(transport,context,randomUUID(),randomUUID),
   error=>error?.status===403);
  assert((await actions.load("NEW")).some(item=>item.protocolId===protocol));
  const detail=await actions.open(protocol);
  assert.equal(detail.status,"RECEBIDA");
  // V5.16: pedido HTTP com sessão real, confirmado e auditável no SQL 026.
  const supportPath="/api/v1/guarda/transito/"+protocol+"/apoio";
  const supportHeaders=()=>({Authorization:"Bearer "+secureStore.value,
   "X-JeriFlow-Municipality-Id":municipalityId});
  const supportId=randomUUID();
  const sendSupport=(id,reason,note)=>fetch(base+supportPath,{method:"POST",
   headers:{...supportHeaders(),"Content-Type":"application/json"},
   body:JSON.stringify({requestId:id,reason,note})});
  const recorded=await sendSupport(supportId,"Necessidade de outro agente","Apoio fictício registrado.");
  assert.equal(recorded.status,200);
  assert.deepEqual(await recorded.json(),{requestId:supportId,protocolId:protocol,
   recorded:true,alreadyProcessed:false});
  const replaySupport=await sendSupport(supportId,"Necessidade de outro agente","Apoio fictício registrado.");
  assert.equal(replaySupport.status,200);
  assert.equal((await replaySupport.json()).alreadyProcessed,true);
  assert.equal((await sendSupport(supportId,"Via bloqueada","Apoio fictício registrado.")).status,409);
  const supportRows=(await owner.query(
   "SELECT reason,note,guard_user_id FROM app.guard_v516_support_requests WHERE request_id=$1",
   [supportId])).rows;
  assert.equal(supportRows.length,1);
  assert.equal(supportRows[0].reason,"Necessidade de outro agente");
  assert.equal(supportRows[0].note,"Apoio fictício registrado.");
  assert.equal(supportRows[0].guard_user_id,guard.userId);
  assert.equal((await owner.query(
   "SELECT status FROM app.citizen_v516_traffic_protocols WHERE id=$1",
   [protocol])).rows[0].status,"RECEBIDA","apoio não modifica status");
  assert.equal((await fetch(base+"/api/v1/guarda/apoios",{headers:supportHeaders()})).status,403);
  await actions.accept(protocol);
  assert((await actions.load("IN_SERVICE")).some(item=>item.protocolId===protocol));
  await actions.finish(protocol,{result:"Situação já resolvida",
   action:"Sem providência necessária",note:"Registro fictício confirmado após login verdadeiro."});
  assert((await actions.load("FINISHED")).some(item=>item.protocolId===protocol));
  const round=(await owner.query(
   "SELECT service_result,service_action,service_note FROM app.guard_v516_service_rounds WHERE protocol_id=$1",
   [protocol])).rows;
  assert.equal(round.length,1);
  assert.equal(round[0].service_result,"Situação já resolvida");
  assert.equal(round[0].service_action,"Sem providência necessária");
  assert.equal(round[0].service_note,"Registro fictício confirmado após login verdadeiro.");
  assert.equal((await owner.query(
   "SELECT status FROM app.citizen_v516_traffic_protocols WHERE id=$1",[protocol])).rows[0].status,"FINALIZADA");
  // HTTP real + SQL 025 + identidade real, somente no runner descartavel.
  const shiftPath="/api/v1/guarda/plantao";
  const shiftHeaders=()=>({Authorization:"Bearer "+secureStore.value,
   "X-JeriFlow-Municipality-Id":municipalityId});
  const initial=await fetch(base+shiftPath,{headers:shiftHeaders()});
  assert.equal(initial.status,200);
  assert.equal((await initial.json()).onShift,true);
  const shiftId=randomUUID();
  const update=async(id,value)=>fetch(base+shiftPath,{method:"POST",
   headers:{...shiftHeaders(),"Content-Type":"application/json"},
   body:JSON.stringify({requestId:id,onShift:value})});
  const disabled=await update(shiftId,false);
  assert.equal(disabled.status,200);
  assert.equal((await disabled.json()).onShift,false);
  const replay=await update(shiftId,false);
  assert.equal(replay.status,200);
  assert.equal((await replay.json()).alreadyProcessed,true);
  assert.equal((await (await fetch(base+shiftPath,{headers:shiftHeaders()})).json()).onShift,false);
  assert.equal((await update(shiftId,true)).status,409);
  const events=await owner.query("SELECT count(*)::integer AS n FROM app.guard_v516_shift_events WHERE request_id=$1",[shiftId]);
  assert.equal(events.rows[0].n,1);
  const restored=await update(randomUUID(),true);
  assert.equal(restored.status,200);
  assert.equal((await restored.json()).onShift,true);
  // Não é permitido criar novo pedido após a finalização.
  assert.equal((await sendSupport(randomUUID(),"Outro","Após finalização.")).status,409);
  const oldToken=secureStore.value;
  await controller.logout();
  assert.equal(controller.snapshot().mode,"login");
  assert.equal(secureStore.value,null);
  await assert.rejects(actions.load("FINISHED"),error=>error?.status===401);
  const stale=bearerTransport(()=>base,{async get(){return oldToken;},async set(){},async remove(){}});
  await assert.rejects(stale.request("/auth/me"),error=>error?.status===401);
  const revokedShift=await fetch(base+shiftPath,{headers:{Authorization:"Bearer "+oldToken,
   "X-JeriFlow-Municipality-Id":municipalityId}});
  assert.equal(revokedShift.status,403);
  const revokedSupport=await fetch(base+supportPath,{method:"POST",
   headers:{Authorization:"Bearer "+oldToken,"X-JeriFlow-Municipality-Id":municipalityId,
    "Content-Type":"application/json"},
   body:JSON.stringify({requestId:randomUUID(),reason:"Outro",note:"Sessão revogada"})});
  assert.equal(revokedSupport.status,403);
  // Outro login REAL de uma conta sem papel da Guarda.
  const touristStore=vault(),touristTransport=bearerTransport(()=>base,touristStore);
  const touristController=new AuthController(touristTransport);
  await touristController.login(touristEmail,touristPassword);
  assert.equal(touristController.snapshot().mode,"home");
  const outsider=touristController.snapshot().context;
  assert(outsider);
  assert.deepEqual(guardEligibleMunicipalitiesV516(outsider),[]);
  await assert.rejects(
   guardAuthorizedActionsV516(touristTransport,outsider,municipalityId,randomUUID),
   error=>error?.status===403);
  await assert.rejects(touristTransport.request("/access?"+
   new URLSearchParams({municipalityId,permission:"mobile:guarda:access"})),
   error=>error?.status===403);
  const touristShift=await fetch(base+shiftPath,{headers:{Authorization:"Bearer "+touristStore.value,
   "X-JeriFlow-Municipality-Id":municipalityId}});
  assert.equal(touristShift.status,403);
  const touristSupport=await fetch(base+supportPath,{method:"POST",
   headers:{Authorization:"Bearer "+touristStore.value,
    "X-JeriFlow-Municipality-Id":municipalityId,"Content-Type":"application/json"},
   body:JSON.stringify({requestId:randomUUID(),reason:"Outro",note:"Sem autorização"})});
  assert.equal(touristSupport.status,403);
  await touristController.logout();
 }finally{
  server.closeAllConnections();
  if(server.listening)await new Promise(ok=>server.close(ok));
  await Promise.allSettled([owner.end(),app.end(),citizenAccounts.close(),read.close(),mutate.close(),shift.close(),support.close(),identity.close()]);
 }
});
