import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import pg from "pg";
import {CitizenAccountsV516} from "../../apps/api/src/citizen-accounts-v516.ts";
import {GuardMutationServiceV516} from "../../apps/api/src/guard-traffic-mutation-http-v516.ts";
import {GuardTrafficReadServiceV516} from "../../apps/api/src/guard-traffic-read-http-v516.ts";
import {guardScreenActionsV516} from "../../apps/guarda/guard-screen-actions-v516.ts";
import {bearerTransport} from "../../packages/auth/client.ts";
import {createApp} from "../../apps/api/src/server.ts";

const ownerDsn=process.env.JF_V516_TEST_OWNER_DSN;
const appDsn=process.env.JF_V516_TEST_APP_DSN;
if(!ownerDsn||!appDsn)throw Error("EPHEMERAL_POSTGRES_REQUIRED");
const sha=s=>createHash("sha256").update(s).digest("hex");
const by=code=>e=>e?.code===code;
const mid=randomUUID(),otherMid=randomUUID();
const tok1=randomBytes(32).toString("base64url");
const tok2=randomBytes(32).toString("base64url");
const tokAdmin=randomBytes(32).toString("base64url");
const tokOther=randomBytes(32).toString("base64url");
const tokTourist=randomBytes(32).toString("base64url");
const resultOptions=[
 "Veículo encontrado","Veículo não encontrado","Situação já resolvida","Denúncia não confirmada"
];
const actionOptions=[
 "Orientação realizada","Autuação realizada","Veículo removido/direcionado",
 "Solicitado apoio","Sem providência necessária"
];
test("V5.16 Guarda: ACEITAR -> ATENDER -> FINALIZAR atomicamente no protocolo Cidadão único",
 {timeout:180000},async t=>{
 const owner=new pg.Client({connectionString:ownerDsn});
 const app=new pg.Client({connectionString:appDsn});
 const racer=new pg.Client({connectionString:appDsn});
 const accounts=new CitizenAccountsV516(appDsn);
 const ids={};
 try{
  await owner.connect();
  await owner.query(
   "CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS "+
   "PASSWORD 'ephemeral-jeriflow-test-only'");
  await owner.query("CREATE SCHEMA app");
  await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
  const names=[
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
   "023-citizen-v516-guard-queue.sql",
   "024-citizen-v516-guard-service.sql",
   "025-citizen-v516-guard-shift.sql",
   "026-citizen-v516-guard-support.sql",
   "027-citizen-v516-guard-flags.sql",
   "028-citizen-v516-flag-contestation.sql"
  ];
  for(const name of names)await owner.query(readFileSync(new URL(
    "../../infra/migrations/"+name,import.meta.url),"utf8"));
  await owner.query("INSERT INTO app.municipalities(id,slug,display_name) "+
   "VALUES($1,'guard-service-test-a','Município sintético A'),"+
   "($2,'guard-service-test-b','Município sintético B')",[mid,otherMid]);
  async function identity(role,municipality,token){
   const id=randomUUID();
   await owner.query(
    "INSERT INTO app.identity_users(id,email,display_name,password_hash,"+
    "email_verified_at,mfa_secret,mfa_version) "+
    "VALUES($1,$2,$3,'test-only',clock_timestamp(),'synthetic-totp',1)",
    [id,"guard-"+id+"@example.invalid","Guarda Fictício "+role]);
   await owner.query(
    "INSERT INTO app.memberships(user_id,municipality_id,role_code) "+
    "VALUES($1,$2,$3)",[id,municipality,role]);
   await owner.query(
    "INSERT INTO app.identity_sessions(token_hash,user_id,auth_version,mfa_version,mfa_verified_at) "+
    "VALUES($1,$2,1,1,clock_timestamp())",[sha(token),id]);
   return id;
  }
  ids.guard1=await identity("guarda",mid,tok1);
  ids.guard2=await identity("guarda",mid,tok2);
  ids.admin=await identity("admin-semus",mid,tokAdmin);
  ids.other=await identity("guarda",otherMid,tokOther);
  ids.tourist=await identity("turista",mid,tokTourist);
  await app.connect();await racer.connect();
  const citizen=await accounts.signup({
   municipalityId:mid,name:"Cidadã Fictícia de Teste",
   birthDate:"1993-10-10",phone:"(88) 90000-0000",
   address:"Rua Fictícia",login:"service.guard.citizen",
   password:"SenhaExemplo123",confirmPassword:"SenhaExemplo123"
  });
  const account=(await owner.query(
   "SELECT id FROM app.citizen_v516_accounts WHERE municipality_id=$1 AND citizen_id=$2",
   [mid,citizen.citizenId])).rows[0].id;
  const idsProtocol=[];
  for(let i=0;i<4;i++){
   const photoId=randomUUID(),photoSha=sha("synthetic-guard-service-photo-"+i);
   // Apenas FIXTURE para o teste da operação de campo; scanner real separado.
   await owner.query(
    "INSERT INTO app.citizen_v516_traffic_photo_owners("+
     "photo_id,municipality_id,citizen_account_id,sha256) VALUES($1,$2,$3,$4)",
    [photoId,mid,account,photoSha]);
   await owner.query(
    "INSERT INTO app.citizen_v516_verified_traffic_media("+
     "photo_id,municipality_id,sha256) VALUES($1,$2,$3)",
    [photoId,mid,photoSha]);
   const q=await app.query(
    "SELECT app.citizen_v516_traffic_submit("+
     "$1::uuid,$2::text,NULL::text,NULL::text,NULL::date,NULL::text,"+
     "$3::text,$4::text,$5::text,$6::text,$7::uuid,$8::text) AS id",
    [mid,sha(citizen.accessToken),"Estacionamento irregular",
     "Rua Fictícia "+i,"ABC1234","Ocorrência totalmente fictícia para testar o atendimento",
     photoId,photoSha]);
   idsProtocol.push(q.rows[0].id);
  }
  const accept=(client,tok,proto,request,municipality=mid)=>client.query(
   "SELECT app.guard_v516_accept($1::uuid,$2::text,$3::text,$4::uuid) AS result",
   [municipality,sha(tok),proto,request]);
  const finish=(client,tok,proto,request,
    result=resultOptions[0],action=actionOptions[0],note="",municipality=mid)=>
    client.query("SELECT app.guard_v516_finish("+
      "$1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::text,$7::text) AS result",
      [municipality,sha(tok),proto,request,result,action,note]);
  const queue=async()=> (await app.query("SELECT app.citizen_v516_guard_queue("+
    "$1::uuid,$2::text,'ALL',NULL::text,50) AS result",[mid,sha(tok1)]))
    .rows[0].result.items;
  const state=async proto=>(await owner.query(
    "SELECT status FROM app.citizen_v516_traffic_protocols WHERE id=$1",[proto])).rows[0].status;
  const count=async table=>(await owner.query(
    "SELECT count(*)::integer AS n FROM app."+table)).rows[0].n;

  await t.test("não assume sem papel GUARDA, mesmo administrador, turista ou município errado",async()=>{
   for(const token of [tokAdmin,tokTourist]){
    await assert.rejects(accept(app,token,idsProtocol[0],randomUUID()),by("JF003"));
   }
   await assert.rejects(accept(app,tokOther,idsProtocol[0],randomUUID()),by("JF003"));
   await assert.rejects(accept(app,tok1,idsProtocol[0],randomUUID(),otherMid),by("JF003"));
   await assert.rejects(finish(app,tok1,idsProtocol[0],randomUUID()),by("JF005"));
   assert.equal(await state(idsProtocol[0]),"RECEBIDA");
   assert.equal(await count("guard_v516_service_events"),0);
  });
  await t.test("assumir pela Guarda cria UMA rodada e muda o protocolo canônico",async()=>{
   const req=randomUUID();
   ids.acceptReq=req;
   const r=(await accept(app,tok1,idsProtocol[0],req)).rows[0].result;
   assert.deepEqual(r,{protocolId:idsProtocol[0],status:"EM ATENDIMENTO",
     alreadyProcessed:false});
   assert.equal(await state(idsProtocol[0]),"EM ATENDIMENTO");
   const repeat=(await accept(app,tok1,idsProtocol[0],req)).rows[0].result;
   assert.equal(repeat.alreadyProcessed,true);
   assert.equal(await count("guard_v516_service_rounds"),1);
   assert.equal(await count("guard_v516_service_events"),1);
   assert.equal((await queue()).find(x=>x.protocolId===idsProtocol[0]).status,
     "EM ATENDIMENTO");
  });
  await t.test("outro guarda não assume ou finaliza ocorrência já assumida",async()=>{
   await assert.rejects(accept(app,tok2,idsProtocol[0],randomUUID()),by("JF005"));
   await assert.rejects(finish(app,tok2,idsProtocol[0],randomUUID()),by("JF003"));
   await assert.rejects(accept(app,tok2,idsProtocol[0],ids.acceptReq),by("JF005"));
   assert.equal(await state(idsProtocol[0]),"EM ATENDIMENTO");
   assert.equal(await count("guard_v516_service_events"),1);
  });
  await t.test("opções de situação e providência são exatamente as do HTML, nota limitada",async()=>{
   await assert.rejects(finish(app,tok1,idsProtocol[0],randomUUID(),
     "resultado inventado",actionOptions[0]),by("JF001"));
   await assert.rejects(finish(app,tok1,idsProtocol[0],randomUUID(),
     resultOptions[0],"Multa criada automaticamente"),by("JF001"));
   await assert.rejects(finish(app,tok1,idsProtocol[0],randomUUID(),
     resultOptions[0],actionOptions[0],"x".repeat(2001)),by("JF001"));
   assert.equal(await state(idsProtocol[0]),"EM ATENDIMENTO");
   assert.equal(await count("guard_v516_service_events"),1);
  });
  await t.test("FINALIZAR grava resultado e trilha na mesma transação, sem mexer na foto",async()=>{
   const req=randomUUID();ids.finishReq=req;
   const r=(await finish(app,tok1,idsProtocol[0],req,
     resultOptions[2],actionOptions[4],"  Resolvida antes da chegada.  ")).rows[0].result;
   assert.deepEqual(r,{protocolId:idsProtocol[0],status:"FINALIZADA",
     alreadyProcessed:false});
   assert.equal(await state(idsProtocol[0]),"FINALIZADA");
   assert.equal(await count("guard_v516_service_rounds"),1);
   assert.equal(await count("guard_v516_service_events"),2);
   const rounds=(await owner.query(
    "SELECT guard_user_id,service_result,service_action,service_note,finished_at "+
    "FROM app.guard_v516_service_rounds WHERE protocol_id=$1",
    [idsProtocol[0]])).rows;
   assert.equal(rounds.length,1);
   assert.equal(rounds[0].guard_user_id,ids.guard1);
   assert.equal(rounds[0].service_result,resultOptions[2]);
   assert.equal(rounds[0].service_action,actionOptions[4]);
   assert.equal(rounds[0].service_note,"Resolvida antes da chegada.");
   assert(rounds[0].finished_at);
   const repeat=(await finish(app,tok1,idsProtocol[0],req)).rows[0].result;
   assert.equal(repeat.alreadyProcessed,true);
   assert.equal(await count("guard_v516_service_events"),2);
   assert.equal(await count("citizen_v516_traffic_protocols"),4);
   assert.equal(await count("citizen_v516_verified_traffic_media"),4);
  });
  await t.test("finalizada é terminal para Guarda; protocolo não é duplicado",async()=>{
   await assert.rejects(accept(app,tok1,idsProtocol[0],randomUUID()),by("JF005"));
   await assert.rejects(finish(app,tok1,idsProtocol[0],randomUUID()),by("JF005"));
   await assert.rejects(finish(app,tok1,idsProtocol[0],ids.acceptReq),by("JF005"));
   assert.equal(await count("guard_v516_service_rounds"),1);
  });
  await t.test("concorrência real: dois guardas disputam a mesma denúncia e só UM vence",async()=>{
   const id=idsProtocol[1];
   const r=await Promise.allSettled([
    accept(app,tok1,id,randomUUID()),accept(racer,tok2,id,randomUUID())
   ]);
   assert.equal(r.filter(x=>x.status==="fulfilled").length,1);
   assert.equal(r.filter(x=>x.status==="rejected"&&x.reason?.code==="JF005").length,1);
   assert.equal(await state(id),"EM ATENDIMENTO");
   assert.equal((await owner.query(
    "SELECT count(*)::integer AS n FROM app.guard_v516_service_rounds WHERE protocol_id=$1",
    [id])).rows[0].n,1);
  });
  await t.test("papéis sem SELECT direto e histórico acessível somente a Guarda/SEMUS",async()=>{
   await assert.rejects(app.query("SELECT * FROM app.guard_v516_service_rounds"),by("42501"));
   await assert.rejects(app.query("SELECT * FROM app.guard_v516_service_events"),by("42501"));
   const history=(await app.query(
    "SELECT app.guard_v516_service_history($1::uuid,$2::text,$3::text) AS info",
    [mid,sha(tokAdmin),idsProtocol[0]])).rows[0].info;
   assert.equal(history.protocolId,idsProtocol[0]);
   assert.equal(history.rounds.length,1);
   assert.equal(history.rounds[0].serviceResult,resultOptions[2]);
   assert.equal(history.rounds[0].serviceNote,"Resolvida antes da chegada.");
   await assert.rejects(app.query(
    "SELECT app.guard_v516_service_history($1::uuid,$2::text,$3::text)",
    [mid,sha(tokTourist),idsProtocol[0]]),by("JF003"));
   assert.equal((await owner.query(
    "SELECT to_regclass('app.guarda_occurrences') AS name")).rows[0].name,null);
  });
  // ETAPA 30: acrescentada após revisão do original sem substituir testes
  // de aceitar/finalizar. onShift é disponibilidade, NÃO permissão extra.
  const shiftGet=(client,token,municipality=mid)=>client.query(
    "SELECT app.guard_v516_shift_get($1::uuid,$2::text) AS result",
    [municipality,sha(token)]);
  const shiftSet=(client,token,request,value,municipality=mid)=>client.query(
    "SELECT app.guard_v516_shift_set("+
    "$1::uuid,$2::text,$3::uuid,$4::boolean) AS result",
    [municipality,sha(token),request,value]);
  await t.test("plantão inicial EM SERVIÇO preserva onShift=true da V5.16",async()=>{
    const a=(await shiftGet(app,tok1)).rows[0].result;
    assert.equal(a.onShift,true);
    assert.equal(a.updatedAt,null);
    const b=(await shiftGet(app,tok2)).rows[0].result;
    assert.equal(b.onShift,true);
    assert.equal(await count("guard_v516_shift_events"),0);
    assert.equal(await count("guard_v516_shift_presence"),0);
  });
  await t.test("botão fora de serviço persiste por GUARDA/município e replay não alterna",async()=>{
    ids.shiftReq=randomUUID();
    const a=(await shiftSet(app,tok1,ids.shiftReq,false)).rows[0].result;
    assert.equal(a.onShift,false);
    assert.equal(a.alreadyProcessed,false);
    const repeated=(await shiftSet(app,tok1,ids.shiftReq,false)).rows[0].result;
    assert.equal(repeated.onShift,false);
    assert.equal(repeated.alreadyProcessed,true);
    assert.equal((await shiftGet(app,tok1)).rows[0].result.onShift,false);
    assert.equal((await shiftGet(app,tok2)).rows[0].result.onShift,true);
    assert.equal(await count("guard_v516_shift_events"),1);
    assert.equal(await count("guard_v516_shift_presence"),1);
    await assert.rejects(shiftSet(app,tok1,ids.shiftReq,true),by("JF005"));
    await assert.rejects(shiftSet(app,tok2,ids.shiftReq,false),by("JF005"));
    assert.equal(await count("guard_v516_shift_events"),1);
  });
  await t.test("plantão não inventa restrição de atendimento ausente no HTML",async()=>{
    assert.equal((await shiftGet(app,tok1)).rows[0].result.onShift,false);
    const id=idsProtocol[3];
    await accept(app,tok1,id,randomUUID());
    assert.equal(await state(id),"EM ATENDIMENTO");
    await finish(app,tok1,id,randomUUID(),
      resultOptions[0],actionOptions[0],"Atendimento sintético");
    assert.equal(await state(id),"FINALIZADA");
    assert.equal((await shiftGet(app,tok1)).rows[0].result.onShift,false);
  });
  await t.test("voltar EM SERVIÇO e repetir pedido antigo não desfaz estado recente",async()=>{
    const r=(await shiftSet(app,tok1,randomUUID(),true)).rows[0].result;
    assert.equal(r.onShift,true);
    const old=(await shiftSet(app,tok1,ids.shiftReq,false)).rows[0].result;
    assert.equal(old.alreadyProcessed,true);
    assert.equal(old.onShift,true,"replay antigo não desativa plantão novamente");
    assert.equal((await shiftGet(app,tok1)).rows[0].result.onShift,true);
    assert.equal(await count("guard_v516_shift_events"),2);
  });
  await t.test("duas atualizações reais concorrentes ficam auditadas e consistentes",async()=>{
    const requests=[randomUUID(),randomUUID()];
    const results=await Promise.all([
      shiftSet(app,tok2,requests[0],false),
      shiftSet(racer,tok2,requests[1],true)
    ]);
    assert(results.every(x=>x.rows[0].result.alreadyProcessed===false));
    const current=(await shiftGet(app,tok2)).rows[0].result.onShift;
    assert.equal(typeof current,"boolean");
    const records=await owner.query(
      "SELECT on_shift FROM app.guard_v516_shift_events "+
      "WHERE request_id=$1 OR request_id=$2",[...requests]);
    assert.equal(records.rowCount,2);
    assert.equal(await count("guard_v516_shift_events"),4);
    assert.equal(await count("guard_v516_shift_presence"),2);
  });
  await t.test("somente guarda com sessão válida consulta/muda plantão",async()=>{
    await assert.rejects(shiftGet(app,tokAdmin),by("JF003"));
    await assert.rejects(shiftGet(app,tokTourist),by("JF003"));
    await assert.rejects(shiftGet(app,tok1,otherMid),by("JF003"));
    await assert.rejects(shiftSet(app,tokAdmin,randomUUID(),true),by("JF003"));
    await assert.rejects(shiftSet(app,tok1,randomUUID(),null),by("JF001"));
    await assert.rejects(app.query(
      "SELECT * FROM app.guard_v516_shift_presence"),by("42501"));
    await assert.rejects(app.query(
      "SELECT * FROM app.guard_v516_shift_events"),by("42501"));
  });
  // Etapa 31: pedido de apoio registra EVENTO e não cria status de denúncia.
  const supportSend=(client,token,proto,request,reason,note="",municipality=mid)=>
    client.query("SELECT app.guard_v516_support_submit("+
      "$1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::text) AS result",
      [municipality,sha(token),proto,request,reason,note]);
  const supportAdmin=(client,token,after=null,limit=50,municipality=mid)=>
    client.query("SELECT app.guard_v516_support_admin_queue("+
      "$1::uuid,$2::text,$3::uuid,$4::integer) AS result",
      [municipality,sha(token),after,limit]);
  await t.test("motivos EXATOS do suporte V5.16 e perfil Guarda obrigatórios",async()=>{
    for(const invalid of ["Outro motivo não previsto","",null]){
      await assert.rejects(supportSend(app,tok1,idsProtocol[2],
        randomUUID(),invalid,"teste"),by("JF001"));
    }
    await assert.rejects(supportSend(app,tok1,idsProtocol[2],
      randomUUID(),"Via bloqueada","x".repeat(2001)),by("JF001"));
    await assert.rejects(supportSend(app,tokAdmin,idsProtocol[2],
      randomUUID(),"Via bloqueada",""),by("JF003"));
    await assert.rejects(supportSend(app,tokTourist,idsProtocol[2],
      randomUUID(),"Via bloqueada",""),by("JF003"));
    await assert.rejects(supportSend(app,tok1,idsProtocol[2],
      randomUUID(),"Via bloqueada","",otherMid),by("JF003"));
    await assert.rejects(supportSend(app,tok1,idsProtocol[0],
      randomUUID(),"Via bloqueada",""),by("JF005"));
    assert.equal(await count("guard_v516_support_requests"),0);
  });
  await t.test("apoio em denúncia RECEBIDA mantém status canônico e não despacha ninguém",async()=>{
    ids.supportReq=randomUUID();
    const resp=(await supportSend(app,tok1,idsProtocol[2],
      ids.supportReq,"Necessidade de outro agente","  Agente pediu reforço. ")).rows[0].result;
    assert.deepEqual(resp,{requestId:ids.supportReq,
      protocolId:idsProtocol[2],recorded:true,alreadyProcessed:false});
    assert.equal(await state(idsProtocol[2]),"RECEBIDA",
     "um pedido de apoio NÃO muda o protocolo antes do atendimento");
    assert.equal(await count("guard_v516_support_requests"),1);
    const repeated=(await supportSend(app,tok1,idsProtocol[2],
      ids.supportReq,"Necessidade de outro agente","Agente pediu reforço.")).rows[0].result;
    assert.equal(repeated.alreadyProcessed,true);
    assert.equal(await count("guard_v516_support_requests"),1);
    await assert.rejects(supportSend(app,tok1,idsProtocol[2],
      ids.supportReq,"Via bloqueada","Agente pediu reforço."),by("JF005"));
    await assert.rejects(supportSend(app,tok2,idsProtocol[2],
      ids.supportReq,"Necessidade de outro agente","Agente pediu reforço."),by("JF005"));
    assert.equal(await count("citizen_v516_traffic_protocols"),4);
  });
  await t.test("duas conexões com mesmo request ID geram UM pedido de apoio",async()=>{
    const request=randomUUID();
    const calls=await Promise.all([
      supportSend(app,tok2,idsProtocol[1],request,"Via bloqueada","Via interditada"),
      supportSend(racer,tok2,idsProtocol[1],request,"Via bloqueada","Via interditada")
    ]);
    const duplicateFlags=calls.map(c=>c.rows[0].result.alreadyProcessed).sort();
    assert.deepEqual(duplicateFlags,[false,true]);
    assert.equal(await count("guard_v516_support_requests"),2);
    assert.equal(await state(idsProtocol[1]),"EM ATENDIMENTO");
  });
  await t.test("ADM SEMUS vê eventos registrados, sem dados pessoais do denunciante",async()=>{
    const items=(await supportAdmin(app,tokAdmin)).rows[0].result.items;
    assert.equal(items.length,2);
    for(const item of items){
      assert(item.requestId&&item.protocolId&&item.guardName);
      assert(!("reporter" in item)&&!("citizenId" in item)&&
        !("identityPhone" in item));
      assert(["Via bloqueada","Necessidade de outro agente"].includes(item.reason));
    }
    const first=(await supportAdmin(app,tokAdmin,null,1)).rows[0].result.items;
    assert.equal(first.length,1);
    const next=(await supportAdmin(app,tokAdmin,first[0].requestId,50)).rows[0].result.items;
    assert.equal(next.length,1);
    assert.notEqual(next[0].requestId,first[0].requestId);
    await assert.rejects(supportAdmin(app,tok1),by("JF003"));
    await assert.rejects(supportAdmin(app,tokTourist),by("JF003"));
    await assert.rejects(supportAdmin(app,tokAdmin,null,51),by("JF001"));
    await assert.rejects(supportAdmin(app,tokAdmin,null,50,otherMid),by("JF003"));
  });
  await t.test("pedidos são privados e não modificam ou expõem fotografia",async()=>{
    await assert.rejects(app.query(
      "SELECT * FROM app.guard_v516_support_requests"),by("42501"));
    assert.equal(await count("citizen_v516_verified_traffic_media"),4);
    assert.equal(await count("citizen_v516_traffic_protocols"),4);
    const roles=(await owner.query(
      "SELECT has_function_privilege('jeriflow_app',"+
      "'app.guard_v516_support_submit(uuid,text,text,uuid,text,text)','EXECUTE') AS app,"+
      "has_function_privilege('jeriflow_v516_scan_worker',"+
      "'app.guard_v516_support_submit(uuid,text,text,uuid,text,text)','EXECUTE') AS scanner"
    )).rows[0];
    assert.deepEqual(roles,{app:true,scanner:false});
  });
  // Fase 32 — sem sobrescrever a suíte de Guarda existente.
  // Sinalização é pedido de ANÁLISE: nenhuma sanção automática.
  const submitFlag=(client,token,proto,req,reason,note,municipality=mid)=>
    client.query("SELECT app.guard_v516_flag_submit("+
      "$1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::text) AS result",
      [municipality,sha(token),proto,req,reason,note]);
  const listFlags=(client,token,municipality=mid,after=null,limit=50)=>
    client.query("SELECT app.guard_v516_flags_admin_queue("+
      "$1::uuid,$2::text,$3::text,$4::integer) AS result",
      [municipality,sha(token),after,limit]);
  const reviewFlag=(client,token,proto,req,decision,municipality=mid)=>
    client.query("SELECT app.guard_v516_flag_review("+
      "$1::uuid,$2::text,$3::text,$4::uuid,$5::text) AS result",
      [municipality,sha(token),proto,req,decision]);
  const reasons=[
    "Trote / denúncia falsa",
    "Informação deliberadamente incorreta",
    "Uso abusivo do canal","Reincidência","Outro"
  ];
  await t.test("formulário de sinalização segue CINCO motivos originais e descrição mínima",async()=>{
    for(const bad of ["Outro motivo inventado","",null])
      await assert.rejects(submitFlag(app,tok2,idsProtocol[2],
        randomUUID(),bad,"Descrição sintética com mais de dez caracteres"),by("JF001"));
    await assert.rejects(submitFlag(app,tok2,idsProtocol[2],
      randomUUID(),reasons[0],"curto"),by("JF001"));
    await assert.rejects(submitFlag(app,tok2,idsProtocol[2],
      randomUUID(),reasons[0],"x".repeat(2001)),by("JF001"));
    const sql=(await owner.query(
      "SELECT pg_get_functiondef('app.guard_v516_flag_submit(uuid,text,text,uuid,text,text)'::regprocedure) AS body"
    )).rows[0].body;
    for(const reason of reasons)assert(sql.includes(reason),"Motivo original ausente: "+reason);
    assert.equal(await count("guard_v516_citizen_flags"),0);
  });
  await t.test("somente guarda responsável pelo protocolo EM ATENDIMENTO sinaliza",async()=>{
    const id=idsProtocol[2];
    await assert.rejects(submitFlag(app,tok2,id,randomUUID(),reasons[0],
      "Denúncia não localizada pela equipe no local"),by("JF003"));
    await accept(app,tok2,id,randomUUID());
    await assert.rejects(submitFlag(app,tok1,id,randomUUID(),reasons[0],
      "Texto sintético suficientemente longo"),by("JF003"));
    await assert.rejects(submitFlag(app,tokAdmin,id,randomUUID(),reasons[0],
      "Texto sintético suficientemente longo"),by("JF003"));
    await assert.rejects(submitFlag(app,tokTourist,id,randomUUID(),reasons[0],
      "Texto sintético suficientemente longo"),by("JF003"));
    await assert.rejects(submitFlag(app,tok2,id,randomUUID(),reasons[0],
      "Texto sintético suficientemente longo",otherMid),by("JF003"));
    assert.equal(await state(id),"EM ATENDIMENTO");
  });
  await t.test("sinalizar não é punir; replay não registra duas acusações",async()=>{
    ids.flagReq=randomUUID();
    const note="Agente constatou inconsistência relatada no local";
    ids.flagNote=note;
    const first=(await submitFlag(app,tok2,idsProtocol[2],
      ids.flagReq,reasons[1],note)).rows[0].result;
    assert.deepEqual(first,{protocolId:idsProtocol[2],
      status:"EM ANÁLISE",reviewStatus:"PENDENTE",alreadyProcessed:false});
    const repeated=(await submitFlag(app,tok2,idsProtocol[2],
      ids.flagReq,reasons[1],note)).rows[0].result;
    assert.equal(repeated.alreadyProcessed,true);
    await assert.rejects(submitFlag(app,tok2,idsProtocol[2],
      ids.flagReq,reasons[3],note),by("JF005"));
    await assert.rejects(submitFlag(app,tok2,idsProtocol[2],
      randomUUID(),reasons[1],note),by("JF005"));
    assert.equal(await count("guard_v516_citizen_flags"),1);
    assert.equal(await state(idsProtocol[2]),"EM ATENDIMENTO",
      "sinalização NÃO altera o status da denúncia");
    assert.equal((await owner.query(
      "SELECT count(*)::int AS n FROM app.citizen_v516_traffic_protocols"
    )).rows[0].n,4);
  });
  await t.test("ADM SEMUS enxerga fila, mas nenhum dado pessoal é exposto ao guarda visitante",async()=>{
    const list=(await listFlags(app,tokAdmin)).rows[0].result.items;
    assert.equal(list.length,1);
    assert.equal(list[0].protocolId,idsProtocol[2]);
    assert.equal(list[0].reason,reasons[1]);
    assert.equal(list[0].note,ids.flagNote);
    assert.equal(list[0].reviewStatus,"PENDENTE");
    assert(!("citizenPhone" in list[0])&&!("photoId" in list[0]));
    await assert.rejects(listFlags(app,tok2),by("JF003"));
    await assert.rejects(listFlags(app,tokTourist),by("JF003"));
    await assert.rejects(listFlags(app,tokAdmin,otherMid),by("JF003"));
    await assert.rejects(listFlags(app,tokAdmin,mid,null,51),by("JF001"));
    await assert.rejects(app.query(
      "SELECT * FROM app.guard_v516_citizen_flags"),by("42501"));
  });
  // Fase 33 — garantia de contestação do titular sem inventar bloqueios.
  const contestSend=(client,token,proto,req,statement,municipality=mid)=>
    client.query("SELECT app.citizen_v516_flag_contest_submit("+
      "$1::uuid,$2::text,$3::text,$4::uuid,$5::text) AS result",
      [municipality,sha(token),proto,req,statement]);
  const contestMine=(client,token,proto,municipality=mid)=>
    client.query("SELECT app.citizen_v516_flag_contest_mine("+
      "$1::uuid,$2::text,$3::text) AS result",
      [municipality,sha(token),proto]);
  const contestQueue=(client,token,after=null,limit=50,municipality=mid)=>
    client.query("SELECT app.citizen_v516_contest_admin_queue("+
      "$1::uuid,$2::text,$3::text,$4::integer) AS result",
      [municipality,sha(token),after,limit]);
  const contestReview=(client,token,proto,req,decision,note,municipality=mid)=>
    client.query("SELECT app.citizen_v516_contest_admin_review("+
      "$1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::text) AS result",
      [municipality,sha(token),proto,req,decision,note]);
  await t.test("somente titular autenticado pode consultar ou enviar contestação",async()=>{
    const other=await accounts.signup({
      municipalityId:mid,name:"Outra Pessoa Fictícia",
      birthDate:"1998-01-20",phone:"(88) 91111-1111",
      address:"Outra rua fictícia",login:"flag.other.citizen",
      password:"SenhaExemplo123",confirmPassword:"SenhaExemplo123"
    });
    ids.otherCitizen=other.accessToken;
    await assert.rejects(contestMine(app,other.accessToken,idsProtocol[2]),by("JF003"));
    await assert.rejects(contestSend(app,other.accessToken,idsProtocol[2],
      randomUUID(),"Peço que revisem a denúncia que foi legítima"),by("JF003"));
    await assert.rejects(contestSend(app,tok1,idsProtocol[2],
      randomUUID(),"Peço que revisem a denúncia que foi legítima"),by("JF003"));
    await assert.rejects(contestSend(app,citizen.accessToken,idsProtocol[2],
      randomUUID(),"texto"),by("JF001"));
    await assert.rejects(contestSend(app,citizen.accessToken,idsProtocol[2],
      randomUUID(),"Peço que revisem a denúncia que foi legítima",otherMid),by("JF003"));
    assert.equal(await count("citizen_v516_flag_contestations"),0);
  });
  await t.test("cidadão contesta sinalização sem modificar a denúncia nem punir automaticamente",async()=>{
    ids.contestReq=randomUUID();
    const text="Peço revisão da sinalização; a informação foi prestada de boa-fé.";
    ids.contestText=text;
    const response=(await contestSend(app,citizen.accessToken,idsProtocol[2],
      ids.contestReq,text)).rows[0].result;
    assert.deepEqual(response,{protocolId:idsProtocol[2],
      status:"ENVIADA",alreadyProcessed:false});
    const own=(await contestMine(app,citizen.accessToken,idsProtocol[2])).rows[0].result;
    assert.equal(own.available,true);
    assert.equal(own.reason,reasons[1]);
    assert.equal(own.contestationStatus,"ENVIADA");
    assert.equal(own.text,text);
    assert.equal(own.reviewStatus,"PENDENTE");
    assert.equal(await state(idsProtocol[2]),"EM ATENDIMENTO");
    assert.equal(await count("citizen_v516_flag_contestations"),1);
    const repeated=(await contestSend(app,citizen.accessToken,idsProtocol[2],
      ids.contestReq,text)).rows[0].result;
    assert.equal(repeated.alreadyProcessed,true);
    await assert.rejects(contestSend(app,citizen.accessToken,idsProtocol[2],
      randomUUID(),text),by("JF005"));
    await assert.rejects(contestSend(app,citizen.accessToken,idsProtocol[2],
      ids.contestReq,"Outro texto de contestação suficientemente longo"),by("JF005"));
  });
  await t.test("ADM Cidadão e ADM SEMUS veem contestação restrita, sem SELECT direto",async()=>{
    ids.adminCitizenToken=randomBytes(32).toString("base64url");
    ids.adminCitizen=await identity("admin-cidadao",mid,ids.adminCitizenToken);
    for(const adminToken of [tokAdmin,ids.adminCitizenToken]){
      const list=(await contestQueue(app,adminToken)).rows[0].result.items;
      assert.equal(list.length,1);
      assert.equal(list[0].protocolId,idsProtocol[2]);
      assert.equal(list[0].status,"ENVIADA");
      assert.equal(list[0].text,ids.contestText);
    }
    await assert.rejects(contestQueue(app,tok1),by("JF003"));
    await assert.rejects(contestQueue(app,tokTourist),by("JF003"));
    await assert.rejects(contestQueue(app,tokAdmin,null,51),by("JF001"));
    await assert.rejects(contestQueue(app,tokAdmin,null,50,otherMid),by("JF003"));
    await assert.rejects(app.query("SELECT * FROM app.citizen_v516_flag_contestations"),
      by("42501"));
  });
  await t.test("decisão só ADM SEMUS: ARQUIVADA ou ANALISADA; sem punição automática",async()=>{
    await assert.rejects(reviewFlag(app,tok2,idsProtocol[2],
      randomUUID(),"ANALISADA"),by("JF003"));
    await assert.rejects(reviewFlag(app,tokTourist,idsProtocol[2],
      randomUUID(),"ANALISADA"),by("JF003"));
    await assert.rejects(reviewFlag(app,tokAdmin,idsProtocol[2],
      randomUUID(),"BLOQUEADA"),by("JF001"));
    ids.flagReviewReq=randomUUID();
    const reviewed=(await reviewFlag(app,tokAdmin,idsProtocol[2],
      ids.flagReviewReq,"ARQUIVADA")).rows[0].result;
    assert.deepEqual(reviewed,{protocolId:idsProtocol[2],
      reviewStatus:"ARQUIVADA",alreadyProcessed:false});
    const replay=(await reviewFlag(app,tokAdmin,idsProtocol[2],
      ids.flagReviewReq,"ARQUIVADA")).rows[0].result;
    assert.equal(replay.alreadyProcessed,true);
    await assert.rejects(reviewFlag(app,tokAdmin,idsProtocol[2],
      randomUUID(),"ANALISADA"),by("JF005"));
    assert.equal((await listFlags(app,tokAdmin)).rows[0].result.items[0].reviewStatus,
      "ARQUIVADA");
    assert.equal(await state(idsProtocol[2]),"EM ATENDIMENTO");
    const flags=(await owner.query(
      "SELECT reviewed_by,reviewed_at,flag_status,review_status FROM "+
      "app.guard_v516_citizen_flags WHERE protocol_id=$1",
      [idsProtocol[2]])).rows[0];
    assert.equal(flags.reviewed_by,ids.admin);
    assert(flags.reviewed_at);
    assert.equal(flags.flag_status,"EM ANÁLISE");
    assert.equal(flags.review_status,"ARQUIVADA");
  });
  await t.test("ADM julga contestação com justificativa; nunca suspende o Cidadão",async()=>{
    const req=randomUUID();ids.contestReviewReq=req;
    await assert.rejects(contestReview(app,tok1,idsProtocol[2],
      randomUUID(),"ACOLHIDA","Revisão favorável ao cidadão"),by("JF003"));
    await assert.rejects(contestReview(app,tokAdmin,idsProtocol[2],
      randomUUID(),"REJEITADA","Motivo válido e registrado"),by("JF001"));
    await assert.rejects(contestReview(app,tokAdmin,idsProtocol[2],
      randomUUID(),"NÃO ACOLHIDA","cur"),by("JF001"));
    const result=(await contestReview(app,ids.adminCitizenToken,idsProtocol[2],
      req,"ACOLHIDA","A denúncia do cidadão foi considerada legítima.")).rows[0].result;
    assert.deepEqual(result,{protocolId:idsProtocol[2],
      status:"ACOLHIDA",alreadyProcessed:false});
    const replay=(await contestReview(app,ids.adminCitizenToken,idsProtocol[2],
      req,"ACOLHIDA","A denúncia do cidadão foi considerada legítima.")).rows[0].result;
    assert.equal(replay.alreadyProcessed,true);
    await assert.rejects(contestReview(app,tokAdmin,idsProtocol[2],
      randomUUID(),"NÃO ACOLHIDA","Outra decisão arbitrária"),by("JF005"));
    const own=(await contestMine(app,citizen.accessToken,idsProtocol[2])).rows[0].result;
    assert.equal(own.contestationStatus,"ACOLHIDA");
    assert.equal(own.decisionNote,"A denúncia do cidadão foi considerada legítima.");
    const account=(await owner.query(
      "SELECT moderation_status FROM app.citizen_v516_accounts "+
      "WHERE municipality_id=$1 AND citizen_id=$2",[mid,citizen.citizenId])).rows[0];
    assert.equal(account.moderation_status,"ACTIVE",
      "nunca aplicar sanção automática por sinalização/contestação");
    assert.equal(await state(idsProtocol[2]),"EM ATENDIMENTO",
      "contestação NÃO cria estado novo para protocolo de trânsito");
  });
  await t.test("HTTP real POST Atender/Finalizar => PostgreSQL, guarda e histórico canônico",async()=>{
    const photoId=randomUUID(),photoSha=sha("synthetic-guard-http-new-protocol");
    await owner.query(
      "INSERT INTO app.citizen_v516_traffic_photo_owners("+
      "photo_id,municipality_id,citizen_account_id,sha256) VALUES($1,$2,$3,$4)",
      [photoId,mid,account,photoSha]);
    await owner.query(
      "INSERT INTO app.citizen_v516_verified_traffic_media("+
      "photo_id,municipality_id,sha256) VALUES($1,$2,$3)",
      [photoId,mid,photoSha]);
    const created=(await app.query(
      "SELECT app.citizen_v516_traffic_submit("+
      "$1::uuid,$2::text,NULL::text,NULL::text,NULL::date,NULL::text,"+
      "$3::text,$4::text,$5::text,$6::text,$7::uuid,$8::text) AS id",
      [mid,sha(citizen.accessToken),"Circulação irregular",
       "Rua fictícia HTTP","ABC9876","Denúncia fictícia HTTP para Guarda",
       photoId,photoSha])).rows[0].id;
    assert.equal(await state(created),"RECEBIDA");
    const service=new GuardMutationServiceV516(appDsn);
    const server=createApp(undefined,undefined,undefined,undefined,service);
    await new Promise((ok,fail)=>
      server.once("error",fail).listen(0,"127.0.0.1",ok));
    const address=server.address();
    assert(address&&typeof address!=="string");
    const base="http://127.0.0.1:"+address.port+
      "/api/v1/guarda/transito/"+created;
    const post=async(token,route,payload,municipality=mid)=>{
      const resp=await fetch(base+route,{
        method:"POST",
        headers:{authorization:"Bearer "+token,
          "x-jeriflow-municipality-id":municipality,
          "content-type":"application/json"},
        body:JSON.stringify(payload)
      });
      return {status:resp.status,body:await resp.json(),headers:resp.headers};
    };
    try{
      const aId=randomUUID();
      const a=await post(tok1,"/atender",{requestId:aId});
      assert.equal(a.status,200);
      assert.equal(a.body.status,"EM ATENDIMENTO");
      assert.equal(a.body.alreadyProcessed,false);
      assert.equal(await state(created),"EM ATENDIMENTO");
      const repeat=await post(tok1,"/atender",{requestId:aId});
      assert.equal(repeat.status,200);
      assert.equal(repeat.body.alreadyProcessed,true);
      const admin=await post(tokAdmin,"/atender",{requestId:randomUUID()});
      assert.equal(admin.status,403);
      const wrong=await post(tok2,"/finalizar",{
        requestId:randomUUID(),result:resultOptions[0],
        action:actionOptions[0],note:"outro guarda"
      });
      assert.equal(wrong.status,403);
      const bad=await post(tok1,"/finalizar",{
        requestId:randomUUID(),result:"Resultado inventado",
        action:actionOptions[0],note:"teste"
      });
      assert.equal(bad.status,400);
      assert.equal(await state(created),"EM ATENDIMENTO");
      const fId=randomUUID();
      const payload={requestId:fId,result:resultOptions[0],
        action:actionOptions[0],note:"Verificação real executada em teste"};
      const done=await post(tok1,"/finalizar",payload);
      assert.equal(done.status,200);
      assert.equal(done.body.status,"FINALIZADA");
      assert.equal(await state(created),"FINALIZADA");
      const repeatFinish=await post(tok1,"/finalizar",payload);
      assert.equal(repeatFinish.status,200);
      assert.equal(repeatFinish.body.alreadyProcessed,true);
      const replayOther=await post(tok2,"/finalizar",payload);
      assert.equal(replayOther.status,409);
      const events=(await owner.query(
        "SELECT action FROM app.guard_v516_service_events WHERE protocol_id=$1"+
        " ORDER BY created_at",[created])).rows;
      assert.deepEqual(events.map(x=>x.action),["ACCEPTED","FINISHED"]);
      const round=(await owner.query(
        "SELECT guard_user_id,service_result,service_note FROM "+
        "app.guard_v516_service_rounds WHERE protocol_id=$1",[created])).rows;
      assert.equal(round.length,1);
      assert.equal(round[0].guard_user_id,ids.guard1);
      assert.equal(round[0].service_result,resultOptions[0]);
      assert.equal(round[0].service_note,payload.note);
      const deniedMunicipality=await post(tok1,"/atender",
        {requestId:randomUUID()},otherMid);
      assert.equal(deniedMunicipality.status,403);
    }finally{
      server.closeAllConnections();
      await new Promise(ok=>server.close(ok));
      await service.close();
    }
  });
  await t.test("App Guarda real: fila > detalhe > atender > finalizar via bearer HTTP e PG17",async()=>{
    // Usa somente dados sinteticos em banco temporario. Nada do VPS e nenhuma API real ativada.
    const photoId=randomUUID(),photoSha=sha("synthetic-guard-mobile-complete-flow");
    await owner.query(
      "INSERT INTO app.citizen_v516_traffic_photo_owners("+
      "photo_id,municipality_id,citizen_account_id,sha256) VALUES($1,$2,$3,$4)",
      [photoId,mid,account,photoSha]);
    await owner.query(
      "INSERT INTO app.citizen_v516_verified_traffic_media("+
      "photo_id,municipality_id,sha256) VALUES($1,$2,$3)",
      [photoId,mid,photoSha]);
    const protocol=(await app.query(
      "SELECT app.citizen_v516_traffic_submit("+
      "$1::uuid,$2::text,NULL::text,NULL::text,NULL::date,NULL::text,"+
      "$3::text,$4::text,$5::text,$6::text,$7::uuid,$8::text) AS id",
      [mid,sha(citizen.accessToken),"Transporte irregular",
        "Rua fictícia integração mobile","ABC9876",
        "Ocorrência sintética para validar toda a cadeia RN-HTTP-PG",
        photoId,photoSha])).rows[0].id;
    assert.equal(await state(protocol),"RECEBIDA");
    const read=new GuardTrafficReadServiceV516(appDsn);
    const mutation=new GuardMutationServiceV516(appDsn);
    const server=createApp(undefined,undefined,undefined,read,mutation);
    try {
      await new Promise((ok,fail)=>server.once("error",fail).listen(0,"127.0.0.1",ok));
      const address=server.address();
      assert(address&&typeof address!=="string");
      const base="http://127.0.0.1:"+address.port;
      const makeActions=(token,municipality=mid)=>guardScreenActionsV516(
        bearerTransport(()=>base,{
          get:async()=>token,set:async()=>{},remove:async()=>{}
        }),municipality,randomUUID);
      const denied=makeActions(tokTourist);
      await assert.rejects(denied.load("NEW"),err=>err?.status===403);
      await assert.rejects(makeActions(tok1,otherMid).load("NEW"),err=>err?.status===403);
      assert.equal(await state(protocol),"RECEBIDA");
      const actions=makeActions(tok1);
      const fresh=await actions.load("NEW");
      assert(fresh.some(x=>x.protocolId===protocol));
      const detail=await actions.open(protocol);
      assert.equal(detail.protocolId,protocol);
      assert.equal(detail.status,"RECEBIDA");
      await actions.accept(protocol);
      assert.equal(await state(protocol),"EM ATENDIMENTO");
      const active=await actions.load("IN_SERVICE");
      assert(active.some(x=>x.protocolId===protocol));
      await actions.finish(protocol,{
        result:"Situação já resolvida",
        action:"Sem providência necessária",
        note:"  Atendimento sintético confirmado pela cadeia móvel.  "
      });
      assert.equal(await state(protocol),"FINALIZADA");
      const finished=await actions.load("FINISHED");
      assert(finished.some(x=>x.protocolId===protocol));
      assert(!(await actions.load("NEW")).some(x=>x.protocolId===protocol));
      const rounds=(await owner.query(
        "SELECT guard_user_id,service_result,service_action,service_note "+
        "FROM app.guard_v516_service_rounds WHERE protocol_id=$1",[protocol])).rows;
      assert.equal(rounds.length,1);
      assert.equal(rounds[0].guard_user_id,ids.guard1);
      assert.equal(rounds[0].service_result,"Situação já resolvida");
      assert.equal(rounds[0].service_action,"Sem providência necessária");
      assert.equal(rounds[0].service_note,"Atendimento sintético confirmado pela cadeia móvel.");
      const events=(await owner.query(
        "SELECT action FROM app.guard_v516_service_events WHERE protocol_id=$1 ORDER BY created_at",
        [protocol])).rows;
      assert.deepEqual(events.map(x=>x.action),["ACCEPTED","FINISHED"]);
      // A operação já confirmada é bloqueada NO APP antes de alcançar HTTP.
      await assert.rejects(actions.finish(protocol,{
        result:"Situação já resolvida",
        action:"Sem providência necessária",
        note:"Não duplicar uma ocorrência concluída."
      }),/GUARD_OPERATION_ALREADY_CONFIRMED/);
      assert.equal((await owner.query(
        "SELECT count(*)::int AS n FROM app.guard_v516_service_rounds WHERE protocol_id=$1",
        [protocol])).rows[0].n,1);
    }finally{
      server.closeAllConnections();
      await new Promise(ok=>server.close(ok));
      await Promise.all([read.close(),mutation.close()]);
    }
  });
  await t.test("sessão revogada e membro desativado não operam",async()=>{
   await owner.query(
    "UPDATE app.memberships SET active=false WHERE user_id=$1 AND role_code='guarda'",
    [ids.guard1]);
   await assert.rejects(accept(app,tok1,idsProtocol[2],randomUUID()),by("JF003"));
   await assert.rejects(shiftGet(app,tok1),by("JF003"));
   await assert.rejects(shiftSet(app,tok1,randomUUID(),true),by("JF003"));
   await assert.rejects(supportSend(app,tok1,idsProtocol[2],randomUUID(),
     "Conflito no local",""),by("JF003"));
   await owner.query("DELETE FROM app.identity_sessions WHERE token_hash=$1",
    [sha(tok2)]);
   await assert.rejects(accept(app,tok2,idsProtocol[2],randomUUID()),by("JF003"));
   assert.equal(await state(idsProtocol[2]),"EM ATENDIMENTO",
     "a Guarda já assumiu antes da sinalização e a revogação não altera o estado");
  });
 }finally{
  await accounts.close().catch(()=>{});
  await racer.end().catch(()=>{});
  await app.end().catch(()=>{});
  await owner.end().catch(()=>{});
 }
});
