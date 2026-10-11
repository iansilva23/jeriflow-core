import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import pg from "pg";
import {CitizenAccountsV516} from "../../apps/api/src/citizen-accounts-v516.ts";
import {GuardTrafficReadServiceV516} from "../../apps/api/src/guard-traffic-read-http-v516.ts";
import {createApp} from "../../apps/api/src/server.ts";

const ownerDsn=process.env.JF_V516_TEST_OWNER_DSN;
const appDsn=process.env.JF_V516_TEST_APP_DSN;
if(!ownerDsn||!appDsn)throw Error("EPHEMERAL_POSTGRES_REQUIRED");
const digest=s=>createHash("sha256").update(s).digest("hex");
const by=code=>e=>e?.code===code;
const mid=randomUUID(),otherMid=randomUUID();
const guardToken=randomBytes(32).toString("base64url"),
  adminToken=randomBytes(32).toString("base64url"),
  outsiderToken=randomBytes(32).toString("base64url"),
  otherGuardToken=randomBytes(32).toString("base64url");

test("V5.16 Guarda/SEMUS: filas e detalhes de UM protocolo Cidadão real, sem duplicar ocorrência",
 {timeout:135000},async t=>{
 const owner=new pg.Client({connectionString:ownerDsn});
 const app=new pg.Client({connectionString:appDsn});
 const citizen=new CitizenAccountsV516(appDsn);
 try{
  await owner.connect();
  await owner.query("CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS "+
   "PASSWORD 'ephemeral-jeriflow-test-only'");
  await owner.query("CREATE SCHEMA app");
  await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
  for(const name of [
   "001-identity.sql","002-identity-security.sql","003-account-management.sql",
   "004-citizen-v516.sql","005-citizen-v516-traffic-protocol.sql",
   "006-citizen-v516-scanned-photo-worker.sql",
   "007-citizen-v516-traffic-photo-owner.sql",
   "008-citizen-v516-traffic-confirm-ack.sql",
   "009-citizen-v516-traffic-idempotency.sql",
   "010-citizen-v516-photo-reconciliation-preview.sql",
   "020-parking-v516-register-extensions-exit.sql",
   "021-parking-v516-admin-queries.sql",
   "022-parking-v516-access-tokens.sql",
   "023-citizen-v516-guard-queue.sql"
  ])await owner.query(readFileSync(new URL(
    "../../infra/migrations/"+name,import.meta.url),"utf8"));
  await owner.query("INSERT INTO app.municipalities(id,slug,display_name) "+
   "VALUES($1,'guard-original-one','Cidade fictícia Um'),"+
   "($2,'guard-original-two','Cidade fictícia Dois')",[mid,otherMid]);
  async function identity(role,municipality,token){
   const id=randomUUID();
   await owner.query(
    "INSERT INTO app.identity_users(id,email,display_name,password_hash,"+
    "email_verified_at,mfa_secret,mfa_version) "+
    "VALUES($1,$2,'Funcionário fictício','test-only',clock_timestamp(),'test-totp',1)",
    [id,role+"-"+id+"@example.invalid"]);
   await owner.query(
    "INSERT INTO app.memberships(user_id,municipality_id,role_code) VALUES($1,$2,$3)",
    [id,municipality,role]);
   await owner.query(
    "INSERT INTO app.identity_sessions(token_hash,user_id,auth_version,"+
    "mfa_version,mfa_verified_at) VALUES($1,$2,1,1,clock_timestamp())",
    [digest(token),id]);
   return id;
  }
  const guardId=await identity("guarda",mid,guardToken);
  await identity("admin-semus",mid,adminToken);
  await identity("turista",mid,outsiderToken);
  await identity("guarda",otherMid,otherGuardToken);
  await app.connect();
  const guardHttpService=new GuardTrafficReadServiceV516(appDsn);
  const httpServer=createApp(undefined,undefined,undefined,guardHttpService);
  await new Promise((ok,fail)=>httpServer.once("error",fail).listen(0,"127.0.0.1",ok));
  const address=httpServer.address();
  assert(address&&typeof address!=="string");
  const httpRoot="http://127.0.0.1:"+address.port;
  const httpRequest=async(token,path,municipality=mid,options={})=>{
    const headers={
      authorization:"Bearer "+token,
      "x-jeriflow-municipality-id":municipality,
      ...options.headers
    };
    const response=await fetch(httpRoot+path,{...options,headers});
    return {status:response.status,body:await response.json(),headers:response.headers};
  };

  const person=await citizen.signup({
    municipalityId:mid,name:"Cidadão de Ensaio",
    birthDate:"1994-05-11",phone:"(88) 90000-0000",
    address:"Rua sintética",login:"guard.integration.citizen",
    password:"SenhaDeTeste123",confirmPassword:"SenhaDeTeste123"
  });
  const account=(await owner.query(
    "SELECT id FROM app.citizen_v516_accounts WHERE municipality_id=$1 AND citizen_id=$2",
    [mid,person.citizenId])).rows[0].id;
  // O objetivo aqui é testar SQL de LEITURA da Guarda. A elegibilidade da
  // mídia é inserida como fixture por proprietário do banco de teste;
  // isto NÃO equivale a executar o scanner ClamAV oficial.
  const protocols=[];
  for(let n=0;n<3;n++){
    const photoId=randomUUID(),hash=digest("only-synthetic-photo-"+n);
    await owner.query(
      "INSERT INTO app.citizen_v516_traffic_photo_owners("+
      "photo_id,municipality_id,citizen_account_id,sha256) VALUES($1,$2,$3,$4)",
      [photoId,mid,account,hash]);
    await owner.query(
      "INSERT INTO app.citizen_v516_verified_traffic_media("+
      "photo_id,municipality_id,sha256) VALUES($1,$2,$3)",
      [photoId,mid,hash]);
    const response=await app.query(
      "SELECT app.citizen_v516_traffic_submit("+
      "$1::uuid,$2::text,NULL::text,NULL::text,NULL::date,NULL::text,"+
      "$3::text,$4::text,$5::text,$6::text,$7::uuid,$8::text) AS id",
      [mid,digest(person.accessToken),
       ["Estacionamento irregular","Circulação irregular","Transporte irregular"][n],
       "Rua fictícia "+n,"ABC1234","Situação fictícia para teste de fila",
       photoId,hash]);
    const id=response.rows[0].id;
    protocols.push(id);
  }
  await owner.query("UPDATE app.citizen_v516_traffic_protocols SET status='EM ATENDIMENTO' "+
    "WHERE id=$1",[protocols[1]]);
  await owner.query("UPDATE app.citizen_v516_traffic_protocols SET status='FINALIZADA' "+
    "WHERE id=$1",[protocols[2]]);
  const queue=(token,municipality=mid,filter="ALL",after=null,limit=50)=>
    app.query("SELECT app.citizen_v516_guard_queue("+
      "$1::uuid,$2::text,$3::text,$4::text,$5::integer) AS result",
      [municipality,digest(token),filter,after,limit]);
  const detail=(token,id,municipality=mid)=>
    app.query("SELECT app.citizen_v516_guard_detail("+
      "$1::uuid,$2::text,$3::text) AS result",
      [municipality,digest(token),id]);
  await t.test("Guardas e ADM SEMUS veem EXATAMENTE três protocolos, sem PII na lista",async()=>{
    const rows=(await queue(guardToken)).rows[0].result.items;
    assert.equal(rows.length,3);
    assert.deepEqual(rows.map(x=>x.protocolId),protocols);
    assert.deepEqual(rows.map(x=>x.status),
      ["RECEBIDA","EM ATENDIMENTO","FINALIZADA"]);
    for(const r of rows){
      assert.equal(r.category,"Trânsito (SEMUS)");
      assert.equal(r.destination,"SEMUS / Guarda de trânsito");
      assert.equal(r.hasPhoto,true);
      assert(!("reporter" in r)&&!("identityPhone" in r)&&
        !("photoId" in r)&&!("photoSha" in r));
    }
    const admin=(await queue(adminToken)).rows[0].result.items;
    assert.deepEqual(admin,rows);
    assert.equal((await owner.query(
      "SELECT count(*)::integer AS n FROM app.citizen_v516_traffic_protocols")).rows[0].n,3);
  });
  await t.test("filtros mantêm exatamente os status V5.16",async()=>{
    for(const [filter,status] of [
      ["NEW","RECEBIDA"],["IN_SERVICE","EM ATENDIMENTO"],
      ["FINISHED","FINALIZADA"]
    ]){
      const rows=(await queue(guardToken,mid,filter)).rows[0].result.items;
      assert.equal(rows.length,1);
      assert.equal(rows[0].status,status);
    }
    const first=(await queue(guardToken,mid,"ALL",null,1)).rows[0].result.items;
    assert.equal(first.length,1);
    const next=(await queue(guardToken,mid,"ALL",first[0].protocolId)).rows[0].result.items;
    assert.equal(next.length,2);
    assert(next.every(x=>x.protocolId!==first[0].protocolId));
  });
  await t.test("detalhes restringem identidade pessoal a Guarda/SEMUS autorizados",async()=>{
    const r=(await detail(guardToken,protocols[0])).rows[0].result;
    assert.equal(r.protocolId,protocols[0]);
    assert.equal(r.reporter.name,"Cidadão de Ensaio");
    assert.equal(r.reporter.phone,"(88) 90000-0000");
    assert.equal(r.reporter.citizenId,person.citizenId);
    assert.equal(r.hasPhoto,true);
    assert(!("publicUrl" in r)&&!("photoId" in r)&&!("photoSha" in r));
    await assert.rejects(detail(outsiderToken,protocols[0]),by("JF003"));
    await assert.rejects(detail(guardToken,protocols[0],otherMid),by("JF003"));
    await assert.rejects(detail(otherGuardToken,protocols[0],otherMid),by("JF004"));
  });
  await t.test("não aceita acesso de Turista, prefeitura vizinha nem consulta inválida",async()=>{
    await assert.rejects(queue(outsiderToken),by("JF003"));
    await assert.rejects(queue(guardToken,otherMid),by("JF003"));
    assert.deepEqual((await queue(otherGuardToken,otherMid)).rows[0].result.items,[]);
    await assert.rejects(queue(guardToken,mid,"NEW",null,51),by("JF001"));
    await assert.rejects(queue(guardToken,mid,"inventado"),by("JF001"));
    await assert.rejects(queue(guardToken,mid,"ALL","1;DROP TABLE"),by("JF001"));
    await assert.rejects(detail(guardToken,"not-a-protocol"),by("JF001"));
  });
  await t.test("nenhuma leitura direta da API, scanner ou reconciliação e nenhuma mutação nova",async()=>{
    await assert.rejects(app.query("SELECT * FROM app.citizen_v516_traffic_protocols"),by("42501"));
    const roles=(await owner.query(
      "SELECT has_function_privilege('jeriflow_app',"+
      "'app.citizen_v516_guard_queue(uuid,text,text,text,integer)','EXECUTE') AS app,"+
      "has_function_privilege('jeriflow_v516_scan_worker',"+
      "'app.citizen_v516_guard_queue(uuid,text,text,text,integer)','EXECUTE') AS scanner,"+
      "has_function_privilege('jeriflow_v516_reconciler',"+
      "'app.citizen_v516_guard_queue(uuid,text,text,text,integer)','EXECUTE') AS reconciler"
    )).rows[0];
    assert.deepEqual(roles,{app:true,scanner:false,reconciler:false});
    const parallel=(await owner.query(
      "SELECT to_regclass('app.guarda_occurrences') AS table_name")).rows[0].table_name;
    assert.equal(parallel,null,"esta etapa não inventa tabela paralela da Guarda");
  });
  await t.test("HTTP REAL: fila e detalhe autorizados usam PostgreSQL canônico, sem URLs de fotos",async()=>{
    const list=await httpRequest(guardToken,"/api/v1/guarda/transito?filter=ALL&limit=50");
    assert.equal(list.status,200);
    assert.equal(list.body.items.length,3);
    assert.equal(list.headers.get("cache-control"),"no-store");
    assert.equal(list.headers.get("access-control-allow-origin"),null);
    assert.equal(list.headers.get("x-content-type-options"),"nosniff");
    assert(!JSON.stringify(list.body).includes("Cidadão de Ensaio"));
    assert(!JSON.stringify(list.body).includes("(88) 90000-0000"));
    assert(!JSON.stringify(list.body).includes("photoId"));
    const filtered=await httpRequest(guardToken,
      "/api/v1/guarda/transito?filter=IN_SERVICE&limit=1");
    assert.equal(filtered.status,200);
    assert.equal(filtered.body.items.length,1);
    assert.equal(filtered.body.items[0].status,"EM ATENDIMENTO");
    const adminList=await httpRequest(adminToken,"/api/v1/guarda/transito?filter=FINISHED");
    assert.equal(adminList.status,200);
    assert.equal(adminList.body.items.length,1);
    const detail=await httpRequest(guardToken,
      "/api/v1/guarda/transito/"+protocols[0]);
    assert.equal(detail.status,200);
    assert.equal(detail.body.reporter.name,"Cidadão de Ensaio");
    assert.equal(detail.body.reporter.citizenId,person.citizenId);
    assert(!("publicUrl" in detail.body));
  });
  await t.test("HTTP REAL: credenciais, município, filtro e verbos inválidos nunca expõem PII",async()=>{
    const path="/api/v1/guarda/transito/"+protocols[0];
    for(const [token,municipality,expected] of [
      [outsiderToken,mid,403],[guardToken,otherMid,403],
      [otherGuardToken,otherMid,404]
    ]){
      const response=await httpRequest(token,path,municipality);
      assert.equal(response.status,expected);
      assert(!JSON.stringify(response.body).includes("Cidadão de Ensaio"));
    }
    for(const query of ["?filter=BOGUS","?filter=NEW&filter=ALL",
      "?limit=51","?token=secret","?after=DROP%20TABLE"]){
      const response=await httpRequest(guardToken,
        "/api/v1/guarda/transito"+query);
      assert.equal(response.status,400);
    }
    const unauthorized=await fetch(httpRoot+path).then(async r=>({status:r.status,body:await r.json()}));
    assert.equal(unauthorized.status,401);
    assert.equal(unauthorized.body.error,"GUARD_SESSION_REQUIRED");
    const wrongMethod=await httpRequest(guardToken,path,mid,{method:"POST"});
    assert.equal(wrongMethod.status,405);
    const invalid=await httpRequest(guardToken,"/api/v1/guarda/transito/not-a-protocol");
    assert.equal(invalid.status,400);
  });
  await t.test("sessão revogada e associação desativada bloqueiam próximas leituras",async()=>{
    await owner.query(
      "UPDATE app.memberships SET active=false WHERE user_id=$1 AND role_code='guarda'",
      [guardId]);
    await assert.rejects(queue(guardToken),by("JF003"));
    assert.equal((await httpRequest(guardToken,"/api/v1/guarda/transito")).status,403);
    await owner.query(
      "DELETE FROM app.identity_sessions WHERE token_hash=$1",[digest(adminToken)]);
    await assert.rejects(queue(adminToken),by("JF003"));
  });
 }finally{
   if(typeof httpServer!=="undefined") await new Promise(ok=>httpServer.close(ok));
   if(typeof guardHttpService!=="undefined") await guardHttpService.close();
   await citizen.close().catch(()=>{});
   await app.end().catch(()=>{});
   await owner.end().catch(()=>{});
 }
});
