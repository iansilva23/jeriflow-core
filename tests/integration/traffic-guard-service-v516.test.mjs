import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import pg from "pg";
import {CitizenAccountsV516} from "../../apps/api/src/citizen-accounts-v516.ts";

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
   "026-citizen-v516-guard-support.sql"
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
    assert.equal(await state(idsProtocol[2]),"RECEBIDA");
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
   assert.equal(await state(idsProtocol[2]),"RECEBIDA");
  });
 }finally{
  await accounts.close().catch(()=>{});
  await racer.end().catch(()=>{});
  await app.end().catch(()=>{});
  await owner.end().catch(()=>{});
 }
});
