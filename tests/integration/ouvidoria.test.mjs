import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { migrateIdentity, ownerClient, localIdentityConfiguration } from "../../scripts/identity-database.mjs";
import { provisionIdentity } from "../../scripts/identity-provision.mjs";
import { readIdentityKey, decodeBase32, totp } from "../../apps/api/src/identity-security.ts";
import { IdentityService } from "../../apps/api/src/identity.ts";
import { createApp } from "../../apps/api/src/server.ts";
import { scanOnce } from "../../scripts/ouvidoria-scan-once.mjs";

test("Ouvidoria: protocolos reais, isolamento por município, MFA e trilha de auditoria", { timeout: 120_000 }, async t => {
  const root = fileURLToPath(new URL("../..",import.meta.url)), run=randomUUID();
  const config=localIdentityConfiguration(root);
  await migrateIdentity(root);
  const owner=ownerClient(root);
  await owner.connect();
  const scannerDb=ownerClient(root);
  await scannerDb.connect();
  await scannerDb.query("SET ROLE jeriflow_scanner");
  const app=new pg.Client({connectionString:config.databaseUrl,connectionTimeoutMillis:2000});
  await app.connect();
  const service=new IdentityService(config,{throttleNamespace:`jeriflow:test:${run}:login`,encryptionKey:readIdentityKey(root)});
  const server=createApp(undefined,service);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  const users=[],municipalities=new Set();
  async function request(path,{token,body,method}={}) {
    const response=await fetch(base+"/api/v1"+path,{
      method:method??(body===undefined?"GET":"POST"),
      headers:{...(token?{Authorization:"Bearer "+token}:{}),...(body!==undefined?{"Content-Type":"application/json"}:{})},
      body:body===undefined?undefined:JSON.stringify(body)
    });
    return {status:response.status,data:await response.json()};
  }
  async function person(slug,roles) {
    const email=randomUUID()+"@example.invalid";
    const password=randomBytes(24).toString("base64url");
    const result=await provisionIdentity(root,{email,password,displayName:"Conta fictícia Ouvidoria",platformAdmin:false,
      municipalities:[{slug,displayName:"Município fictício Ouvidoria "+slug,roles}]});
    users.push(result.userId);municipalities.add(result.municipalities[0].id);
    // Fixture de teste isolado: simula email já verificado sem enviar dados reais.
    await owner.query("UPDATE app.identity_users SET email_verified_at=clock_timestamp() WHERE id=$1",[result.userId]);
    return {userId:result.userId,municipalityId:result.municipalities[0].id,email,password};
  }
  async function login(person) {
    const response=await request("/auth/login",{body:{email:person.email,password:person.password}});
    assert.equal(response.status,200);
    let token=response.data.accessToken;
    if(response.data.nextStep==="mfa_enrollment"){
      const setup=await request("/auth/mfa/enroll/start",{token,body:{password:person.password}});
      assert.equal(setup.status,200);
      const code=totp(decodeBase32(setup.data.secret),Math.floor(Date.now()/30000));
      const confirmed=await request("/auth/mfa/enroll/confirm",{token,body:{code}});
      assert.equal(confirmed.status,200);
      token=confirmed.data.accessToken;
    }
    return token;
  }
  try {
    const cityA="ouv-a-"+run,cityB="ouv-b-"+run;
    const citizen=await person(cityA,["cidadao"]);
    const staff=await person(cityA,["admin-cidadao"]);
    const outsider=await person(cityB,["cidadao"]);
    const ct=await login(citizen),ot=await login(outsider);
    const scannerRole=await scannerDb.query("SELECT current_user AS role");
    assert.equal(scannerRole.rows[0].role,"jeriflow_scanner");
    await assert.rejects(scannerDb.query("SELECT encrypted_bytes FROM app.ouvidoria_attachments"),
      e=>e.code==="42501");
    await assert.rejects(scannerDb.query("UPDATE app.ouvidoria_attachments SET scan_status='clean' WHERE FALSE"),
      e=>e.code==="42501");
    await assert.rejects(app.query("SELECT * FROM app.ouvidoria_scan_claim($1)",[randomUUID()]),
      e=>e.code==="42501");
    const unauthenticated=await request("/ouvidoria/query",{body:{municipalityId:citizen.municipalityId,scope:"meus"}});
    assert.equal(unauthenticated.status,401);
    assert.equal((await request("/ouvidoria/query",{token:ot,
      body:{municipalityId:citizen.municipalityId,scope:"fila"}})).status,403);
    const idempotency=randomUUID();
    const create={operation:"create",municipalityId:citizen.municipalityId,clientRequestId:idempotency,
      category:"denuncia",title:"Iluminação na quadra",description:"A iluminação está apagada nesta área fictícia de testes."};
    const created=await request("/ouvidoria/mutate",{token:ct,body:create});
    assert.equal(created.status,200);assert.equal(created.data.status,"open");
    const protocolId=created.data.protocolId;
    const bytes=Buffer.concat([Buffer.from("%PDF-1.7\n"),Buffer.alloc(80,65)]);
    const attach={municipalityId:citizen.municipalityId,protocolId,clientRequestId:randomUUID(),
      fileName:"iluminacao-teste.pdf",mediaType:"application/pdf",dataBase64:bytes.toString("base64")};
    const uploaded=await request("/ouvidoria/attachments/upload",{token:ct,body:attach});
    assert.equal(uploaded.status,200);assert.equal(uploaded.data.status,"quarantined");
    assert.equal(typeof uploaded.data.attachmentId,"string");
    assert(!JSON.stringify(uploaded.data).includes(attach.dataBase64));
    const same=await request("/ouvidoria/attachments/upload",{token:ct,body:attach});
    assert.equal(same.status,200);assert.equal(same.data.attachmentId,uploaded.data.attachmentId);
    assert.equal((await request("/ouvidoria/attachments/upload",{token:ct,
      body:{...attach,dataBase64:Buffer.concat([Buffer.from("%PDF-1.7\n"),Buffer.alloc(80,66)]).toString("base64")}})).status,409);
    assert.equal((await request("/ouvidoria/attachments/upload",{token:ot,body:attach})).status,404);
    assert.equal((await request("/ouvidoria/attachments/list",{token:ot,
      body:{municipalityId:citizen.municipalityId,protocolId}})).status,404);
    const listed=await request("/ouvidoria/attachments/list",{token:ct,
      body:{municipalityId:citizen.municipalityId,protocolId}});
    assert.equal(listed.status,200);assert.equal(listed.data.items.length,1);
    assert.equal(listed.data.items[0].status,"quarantined");
    // O download permanece DESATIVADO por padrao, inclusive para o autor.
    const readBody={municipalityId:citizen.municipalityId,protocolId,attachmentId:uploaded.data.attachmentId};
    assert.equal((await request("/ouvidoria/attachments/read-test",{token:ct,body:readBody})).status,503);
    const previousReadFlag=process.env.JERIFLOW_ATTACHMENT_READ_TEST_ONLY;
    const previousEnv=process.env.NODE_ENV;
    process.env.JERIFLOW_ATTACHMENT_READ_TEST_ONLY="1";
    process.env.NODE_ENV="test";
    try{
      assert.equal((await request("/ouvidoria/attachments/read-test",{token:ct,body:readBody})).status,404);
      assert.equal((await request("/ouvidoria/attachments/read-test",{token:ot,body:readBody})).status,404);
      process.env.NODE_ENV="production";
      assert.equal((await request("/ouvidoria/attachments/read-test",{token:ct,body:readBody})).status,503);
      process.env.NODE_ENV="development";
      assert.equal((await request("/ouvidoria/attachments/read-test",{token:ct,body:readBody})).status,503);
    }finally{
      if(previousReadFlag===undefined)delete process.env.JERIFLOW_ATTACHMENT_READ_TEST_ONLY;
      else process.env.JERIFLOW_ATTACHMENT_READ_TEST_ONLY=previousReadFlag;
      if(previousEnv===undefined)delete process.env.NODE_ENV;
      else process.env.NODE_ENV=previousEnv;
    }

    assert.deepEqual(Object.keys(listed.data.items[0]).sort(),["createdAt","fileName","id","mediaType","sizeBytes","status"]);
    assert(!JSON.stringify(listed.data).includes(attach.dataBase64));
    // Por padrão a regressão usa mock; na suíte dedicada usa o daemon ClamAV REAL via socket Unix.
    const realSocket=process.env.JERIFLOW_CLAMD_SOCKET;
    const scanned=await scanOnce({owner:scannerDb,identityKey:readIdentityKey(root),
      ...(realSocket?{socketPath:realSocket}:{socketPath:"/not-used",scanner:async (_socketPath,rawBytes)=>{
        assert.deepEqual(rawBytes,bytes);return "clean";
      }})});
    assert.equal(scanned.status,"clean");
    const scannedResult=await owner.query("SELECT scan_status,scan_attempts FROM app.ouvidoria_attachments WHERE id=$1",
      [uploaded.data.attachmentId]);
    assert.equal(scannedResult.rows[0].scan_status,"clean");
    assert.equal(scannedResult.rows[0].scan_attempts,1);
    const eventRow=await owner.query("SELECT result FROM app.ouvidoria_attachment_scan_events WHERE attachment_id=$1",
      [uploaded.data.attachmentId]);
    assert.deepEqual(eventRow.rows.map(x=>x.result),["clean"]);
    // Leitura opt-in SOMENTE no teste local: exige scanner clean, titularidade e auditoria.
    const previousFlag=process.env.JERIFLOW_ATTACHMENT_READ_TEST_ONLY;
    const previousEnvRead=process.env.NODE_ENV;
    process.env.JERIFLOW_ATTACHMENT_READ_TEST_ONLY="1";
    process.env.NODE_ENV="test";
    try{
      const read=await request("/ouvidoria/attachments/read-test",{token:ct,
        body:{municipalityId:citizen.municipalityId,protocolId,attachmentId:uploaded.data.attachmentId}});
      assert.equal(read.status,200);
      assert.equal(read.data.fileName,attach.fileName);
      assert.deepEqual(Buffer.from(read.data.dataBase64,"base64"),bytes);
      const forbidden=await request("/ouvidoria/attachments/read-test",{token:ot,
        body:{municipalityId:citizen.municipalityId,protocolId,attachmentId:uploaded.data.attachmentId}});
      assert.equal(forbidden.status,404);
      const records=await owner.query("SELECT actor_user_id,event_code FROM app.ouvidoria_attachment_access_events WHERE attachment_id=$1",
        [uploaded.data.attachmentId]);
      assert.equal(records.rows.length,1);
      assert.equal(records.rows[0].actor_user_id,citizen.userId);
      assert.equal(records.rows[0].event_code,"read_test");
      await assert.rejects(app.query("SELECT * FROM app.ouvidoria_attachment_access_events"),e=>e.code==="42501");

      // Somente o ultimo evento validado libera leitura local.
      const retryEvent=(await owner.query(
        "INSERT INTO app.ouvidoria_attachment_scan_events(attachment_id,result,scanner_version) VALUES($1,'retry','ci-security-test') RETURNING id",
        [uploaded.data.attachmentId])).rows[0].id;
      try {
        assert.equal((await request("/ouvidoria/attachments/read-test",{token:ct,body:readBody})).status,404);
      }finally{
        await owner.query("DELETE FROM app.ouvidoria_attachment_scan_events WHERE id=$1",[retryEvent]);
      }
      // Alteracao do conteúdo cifrado nunca retorna bytes e é restaurada após o teste.
      const original=(await owner.query(
        "SELECT encrypted_bytes FROM app.ouvidoria_attachments WHERE id=$1",
        [uploaded.data.attachmentId])).rows[0].encrypted_bytes;
      const altered=Buffer.from(original);altered[28]^=1;
      await owner.query("UPDATE app.ouvidoria_attachments SET encrypted_bytes=$1 WHERE id=$2",
        [altered,uploaded.data.attachmentId]);
      try{
        const denied=await request("/ouvidoria/attachments/read-test",{token:ct,body:readBody});
        assert.equal(denied.status,503);
        assert(!Object.hasOwn(denied.data,"dataBase64"));
        assert(!JSON.stringify(denied.data).includes(bytes.toString("base64")));
      }finally{
        await owner.query("UPDATE app.ouvidoria_attachments SET encrypted_bytes=$1 WHERE id=$2",
          [original,uploaded.data.attachmentId]);
      }
      const afterRestore=await request("/ouvidoria/attachments/read-test",{token:ct,body:readBody});
      assert.equal(afterRestore.status,200);
      assert.deepEqual(Buffer.from(afterRestore.data.dataBase64,"base64"),bytes);
    }finally{
      if(previousFlag===undefined)delete process.env.JERIFLOW_ATTACHMENT_READ_TEST_ONLY;
      else process.env.JERIFLOW_ATTACHMENT_READ_TEST_ONLY=previousFlag;
      if(previousEnvRead===undefined)delete process.env.NODE_ENV;
      else process.env.NODE_ENV=previousEnvRead;
    }

    if(realSocket){
      // Assinatura EICAR de LABORATÓRIO, não malware executável nem base oficial do ClamAV.
      const eicar=Buffer.from(["X5O!P%","@AP[4\\","PZX54(P^)7CC)7}$EICAR-",
        "STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join(""),"ascii");
      assert.equal(eicar.length,68);
      const danger=Buffer.concat([Buffer.from("%PDF-1.7\\n"),eicar,Buffer.alloc(60,70)]);
      const infectedBody={...attach,clientRequestId:randomUUID(),
        fileName:"evidencia-laboratorio.pdf",dataBase64:danger.toString("base64")};
      const infectedUpload=await request("/ouvidoria/attachments/upload",{token:ct,body:infectedBody});
      assert.equal(infectedUpload.status,200);
      const infectedScan=await scanOnce({owner:scannerDb,identityKey:readIdentityKey(root),socketPath:realSocket});
      assert.equal(infectedScan.status,"rejected");
      const infectedState=await owner.query("SELECT scan_status FROM app.ouvidoria_attachments WHERE id=$1",
        [infectedUpload.data.attachmentId]);
      assert.equal(infectedState.rows[0].scan_status,"rejected");
      const failedBody={...attach,clientRequestId:randomUUID(),fileName:"teste-indisponivel.pdf"};
      const failedUpload=await request("/ouvidoria/attachments/upload",{token:ct,body:failedBody});
      assert.equal(failedUpload.status,200);
      const failedScan=await scanOnce({owner:scannerDb,identityKey:readIdentityKey(root),
        socketPath:"/tmp/jeriflow-clamd-unavailable-test.sock"});
      assert.equal(failedScan.status,"quarantined");
      const failedState=await owner.query("SELECT scan_status,scan_attempts FROM app.ouvidoria_attachments WHERE id=$1",
        [failedUpload.data.attachmentId]);
      assert.equal(failedState.rows[0].scan_status,"quarantined");
      assert.equal(failedState.rows[0].scan_attempts,1);
      assert.equal((await request("/ouvidoria/attachments/download",{token:ct,body:infectedBody})).status,503);
    }
    const raw=await owner.query("SELECT encrypted_bytes,scan_status FROM app.ouvidoria_attachments WHERE id=$1",
      [uploaded.data.attachmentId]);
    assert.equal(raw.rows[0].scan_status,"clean");
    assert(!Buffer.from(raw.rows[0].encrypted_bytes).includes(bytes));
    assert.equal((await request("/ouvidoria/attachments/upload",{token:ct,
      body:{...attach,clientRequestId:randomUUID(),dataBase64:"not base64"}})).status,400);
    assert.equal((await request("/ouvidoria/attachments/upload",{body:attach})).status,401);
    assert.equal((await request("/ouvidoria/attachments/download",{token:ct,body:attach})).status,503);
    await assert.rejects(app.query("SELECT encrypted_bytes FROM app.ouvidoria_attachments"),e=>e.code==="42501");
    const firstHistory=await request("/ouvidoria/history",{token:ct,
      body:{municipalityId:citizen.municipalityId,protocolId}});
    assert.equal(firstHistory.status,200);
    assert.deepEqual(firstHistory.data.items.map(x=>x.code),["created"]);
    assert.deepEqual(Object.keys(firstHistory.data.items[0]).sort(),["code","createdAt","revision"]);
    assert.equal((await request("/ouvidoria/history",{token:ct,body:{municipalityId:citizen.municipalityId,
      protocolId:randomUUID()}})).status,404);
    assert.equal((await request("/ouvidoria/history",{token:ot,body:{municipalityId:citizen.municipalityId,
      protocolId}})).status,404);
    assert.equal((await request("/ouvidoria/history",{token:ct,body:{municipalityId:citizen.municipalityId,
      protocolId,admin:true}})).status,400);
    assert.equal((await request("/ouvidoria/mutate",{token:ct,body:create})).data.protocolId,protocolId);
    const own=await request("/ouvidoria/query",{token:ct,body:{municipalityId:citizen.municipalityId,scope:"meus"}});
    assert.equal(own.status,200);assert(own.data.items.some(x=>x.id===protocolId));
    assert(!JSON.stringify(own.data).includes("author_user_id"));
    assert.equal((await request("/ouvidoria/query",{token:ot,
      body:{municipalityId:outsider.municipalityId,scope:"meus"}})).data.items.some(x=>x.id===protocolId),false);
    assert.equal((await request("/ouvidoria/mutate",{token:ot,body:{...create,
      municipalityId:citizen.municipalityId,clientRequestId:randomUUID()}})).status,403);
    // Administradores só agem após MFA. O login inicial exige ativação do autenticador.
    const pending=await request("/auth/login",{body:{email:staff.email,password:staff.password}});
    assert.equal(pending.data.nextStep,"mfa_enrollment");
    assert.equal((await request("/ouvidoria/query",{token:pending.data.accessToken,
      body:{municipalityId:citizen.municipalityId,scope:"fila"}})).status,403);
    const st=await login(staff);
    // Avisos: autor e equipe do mesmo município recebem códigos sem payload.
    const citizenNotices=await request("/ouvidoria/notices/query",{token:ct,
      body:{municipalityId:citizen.municipalityId}});
    assert.equal(citizenNotices.status,200);
    assert(citizenNotices.data.items.some(n=>n.protocolId===protocolId&&n.code==="created"));
    const adminNotices=await request("/ouvidoria/notices/query",{token:st,
      body:{municipalityId:citizen.municipalityId}});
    assert.equal(adminNotices.status,200);
    assert(adminNotices.data.unreadCount>=1);
    assert(adminNotices.data.totalCount>=adminNotices.data.unreadCount);
    assert.equal((await request("/ouvidoria/notices/query",{token:ot,
      body:{municipalityId:citizen.municipalityId}})).status,404);
    const notice=adminNotices.data.items.find(n=>n.protocolId===protocolId&&n.code==="created");
    assert(notice&&notice.readAt===null);
    assert.deepEqual(Object.keys(notice).sort(),["code","createdAt","id","protocolId","readAt"]);
    assert(!JSON.stringify(notice).includes("Iluminação na quadra"));
    assert.equal((await request("/ouvidoria/notices/read",{token:ot,
      body:{municipalityId:citizen.municipalityId,noticeId:notice.id}})).status,404);
    assert.equal((await request("/ouvidoria/notices/read",{token:st,
      body:{municipalityId:citizen.municipalityId,noticeId:notice.id}})).status,200);
    const reread=await request("/ouvidoria/notices/query",{token:st,
      body:{municipalityId:citizen.municipalityId}});
    assert(reread.data.items.some(n=>n.id===notice.id&&n.readAt));
    assert.equal(reread.data.unreadCount,adminNotices.data.unreadCount-1);
    assert.equal(reread.data.totalCount,adminNotices.data.totalCount);
    await assert.rejects(app.query("SELECT * FROM app.ouvidoria_notices"),e=>e.code==="42501");
    // Retenção: protocolo fica protegido, revisão é auditada, API não executa apagamento.
    const hold=await owner.query("SELECT legal_hold,reason_code FROM app.ouvidoria_retention_hold WHERE protocol_id=$1",
      [protocolId]);
    assert.equal(hold.rows[0].legal_hold,true);
    assert.equal(hold.rows[0].reason_code,"awaiting_policy");
    assert.equal((await request("/ouvidoria/retention/review",{token:ct,
      body:{municipalityId:citizen.municipalityId,protocolId}})).status,404);
    const retained=await request("/ouvidoria/retention/review",{token:st,
      body:{municipalityId:citizen.municipalityId,protocolId}});
    assert.equal(retained.status,200);
    assert.equal(retained.data.automaticDeletion,false);
    assert.equal(retained.data.protected,true);
    assert.equal((await owner.query("SELECT count(*) AS total FROM app.ouvidoria_retention_audit WHERE protocol_id=$1",
      [protocolId])).rows[0].total,"1");
    await assert.rejects(app.query("DELETE FROM app.ouvidoria_protocols WHERE FALSE"),e=>e.code==="42501");
    const inventory=await request("/ouvidoria/retention/inventory",{token:st,
      body:{municipalityId:citizen.municipalityId}});
    assert.equal(inventory.status,200);
    assert.equal(inventory.data.automaticDeletionEnabled,false);
    assert(inventory.data.inventory.some(x=>x.category==="denuncia"&&x.protectedCount>=1));
    assert.equal((await request("/ouvidoria/retention/inventory",{token:ct,
      body:{municipalityId:citizen.municipalityId}})).status,404);
    const policyDraft=await request("/ouvidoria/retention/draft",{token:st,
      body:{municipalityId:citizen.municipalityId,category:"denuncia",retentionDays:180}});
    assert.equal(policyDraft.status,200);
    assert.equal(policyDraft.data.policyStatus,"awaiting_institutional_approval");
    assert.equal(policyDraft.data.automaticDeletionEnabled,false);
    assert.equal((await request("/ouvidoria/retention/draft",{token:st,
      body:{municipalityId:citizen.municipalityId,category:"denuncia",retentionDays:0}})).status,400);
    const inventory2=await request("/ouvidoria/retention/inventory",{token:st,
      body:{municipalityId:citizen.municipalityId}});
    assert(inventory2.data.policies.some(p=>p.category==="denuncia"&&p.retentionDays===180));
    assert.equal((await request("/ouvidoria/retention/archive",{token:st,
      body:{municipalityId:citizen.municipalityId,protocolId,archived:true}})).status,409);

    // Guarda/SEMUS: registro real, idempotência, acesso municipal e revisão otimista.
    const guarda=await person(cityA,["guarda"]);
    const semus=await person(cityA,["admin-semus"]);
    assert.equal(guarda.municipalityId,citizen.municipalityId);
    assert.equal(semus.municipalityId,citizen.municipalityId);
    const gt=await login(guarda),admSemus=await login(semus);
    const occurrence={operation:"create",municipalityId:guarda.municipalityId,
      clientRequestId:randomUUID(),kind:"apoio",title:"Apoio na quadra",
      description:"Equipe prestou orientação numa situação inteiramente fictícia.",
      locationText:"Quadra central do município fictício",occurredAt:"2026-10-09T18:32:00.000Z"};
    const createdGuarda=await request("/guarda/mutate",{token:gt,body:occurrence});
    assert.equal(createdGuarda.status,200);
    assert.equal(createdGuarda.data.status,"open");
    assert.equal((await request("/guarda/mutate",{token:gt,
      body:{...occurrence,clientRequestId:randomUUID(),locationText:"x"}})).status,400);
    const idGuarda=createdGuarda.data.occurrenceId;
    assert.equal((await request("/guarda/mutate",{token:gt,body:occurrence})).data.occurrenceId,idGuarda);
    assert.equal((await request("/guarda/mutate",{token:gt,
      body:{...occurrence,title:"Título adulterado"}})).status,409);
    assert.equal((await request("/guarda/mutate",{token:st,body:occurrence})).status,403);
    const guList=await request("/guarda/query",{token:gt,body:{municipalityId:guarda.municipalityId}});
    assert.equal(guList.status,200);
    assert(guList.data.items.some(x=>x.id===idGuarda));
    const semusList=await request("/guarda/query",{token:admSemus,body:{municipalityId:guarda.municipalityId}});
    assert.equal(semusList.status,200);
    assert(semusList.data.items.some(x=>x.id===idGuarda));
    const caseDetail=semusList.data.items.find(x=>x.id===idGuarda);
    assert.equal(caseDetail.locationText,occurrence.locationText);
    assert.equal(Date.parse(caseDetail.occurredAt),Date.parse(occurrence.occurredAt));
    const firstCaseHistory=await request("/guarda/history",{token:gt,
      body:{municipalityId:guarda.municipalityId,occurrenceId:idGuarda}});
    assert.equal(firstCaseHistory.status,200);
    assert.deepEqual(firstCaseHistory.data.items.map(x=>x.code),["created"]);
    assert.equal((await request("/guarda/history",{token:ot,
      body:{municipalityId:guarda.municipalityId,occurrenceId:idGuarda}})).status,404);
    assert.equal((await request("/guarda/query",{token:ot,
      body:{municipalityId:guarda.municipalityId}})).status,403);
    assert.equal((await request("/guarda/mutate",{token:gt,
      body:{operation:"review",municipalityId:guarda.municipalityId,occurrenceId:idGuarda,revision:1}})).status,403);
    const review=await request("/guarda/mutate",{token:admSemus,
      body:{operation:"review",municipalityId:guarda.municipalityId,occurrenceId:idGuarda,revision:1}});
    assert.equal(review.status,200);assert.equal(review.data.status,"in_review");
    assert.equal((await request("/guarda/mutate",{token:admSemus,
      body:{operation:"review",municipalityId:guarda.municipalityId,occurrenceId:idGuarda,revision:1}})).status,409);
    const finish=await request("/guarda/mutate",{token:admSemus,
      body:{operation:"close",municipalityId:guarda.municipalityId,occurrenceId:idGuarda,revision:2}});
    assert.equal(finish.status,200);assert.equal(finish.data.status,"closed");
    const guardAudit=await owner.query("SELECT action FROM app.guarda_occurrence_events WHERE occurrence_id=$1 ORDER BY revision",[idGuarda]);
    assert.deepEqual(guardAudit.rows.map(x=>x.action),["created","reviewed","closed"]);
    const fullCaseHistory=await request("/guarda/history",{token:admSemus,
      body:{municipalityId:guarda.municipalityId,occurrenceId:idGuarda}});
    assert.equal(fullCaseHistory.status,200);
    assert.deepEqual(fullCaseHistory.data.items.map(x=>x.code),["created","reviewed","closed"]);
    assert.equal(Object.hasOwn(fullCaseHistory.data.items[0],"actor_user_id"),false);
    await assert.rejects(app.query("SELECT * FROM app.guarda_occurrences"),e=>e.code==="42501");
    // Turismo: solicitação de estacionamento é atendimento, não diária paga nem permissão.
    const tourist=await person(cityA,["turista"]);
    const parkingStaff=await person(cityA,["admin-turismo"]);
    const touristOther=await person(cityB,["turista"]);
    const touristToken=await login(tourist),parkingAdminToken=await login(parkingStaff);
    const outsideTouristToken=await login(touristOther);
    const parkingData={municipalityId:tourist.municipalityId,operation:"create",
      clientRequestId:randomUUID(),vehiclePlate:"ABC1D23",
      areaText:"Ponto de atendimento fictício",serviceDay:"2026-10-10",
      description:"Solicitação fictícia sem pagamento ou autorização."};
    const parkingCreated=await request("/parking/requests/mutate",{token:touristToken,body:parkingData});
    assert.equal(parkingCreated.status,200);
    assert.equal(parkingCreated.data.status,"requested");
    assert.equal(parkingCreated.data.authorizationIssued,false);
    assert.equal(parkingCreated.data.paymentRegistered,false);
    const parkingId=parkingCreated.data.requestId;
    assert.equal((await request("/parking/requests/mutate",{token:touristToken,body:parkingData})).data.requestId,parkingId);
    assert.equal((await request("/parking/requests/mutate",{token:touristToken,
      body:{...parkingData,description:"Solicitação alterada na repetição idempotente."}})).status,409);
    assert.equal((await request("/parking/requests/mutate",{token:touristToken,
      body:{...parkingData,vehiclePlate:"INVALID",clientRequestId:randomUUID()}})).status,400);
    assert.equal((await request("/parking/requests/mutate",{token:ct,body:parkingData})).status,403);
    assert.equal((await request("/parking/requests/mutate",{token:outsideTouristToken,
      body:{...parkingData,clientRequestId:randomUUID()}})).status,403);
    const mine=await request("/parking/requests/query",{token:touristToken,
      body:{municipalityId:tourist.municipalityId,scope:"mine"}});
    assert.equal(mine.status,200);assert(mine.data.items.some(v=>v.id===parkingId));
    assert.equal((await request("/parking/requests/query",{token:touristToken,
      body:{municipalityId:tourist.municipalityId,scope:"queue"}})).status,403);
    assert.equal((await request("/parking/requests/query",{token:outsideTouristToken,
      body:{municipalityId:tourist.municipalityId,scope:"mine"}})).status,403);
    const queue=await request("/parking/requests/query",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId,scope:"queue"}});
    assert.equal(queue.status,200);
    assert(queue.data.items.some(v=>v.id===parkingId&&v.vehiclePlate==="ABC1D23"));
    const beforeParking=await request("/parking/requests/history",{token:touristToken,
      body:{municipalityId:tourist.municipalityId,requestId:parkingId}});
    assert.equal(beforeParking.status,200);
    assert.deepEqual(beforeParking.data.items.map(e=>e.code),["created"]);
    assert.equal((await request("/parking/requests/history",{token:outsideTouristToken,
      body:{municipalityId:tourist.municipalityId,requestId:parkingId}})).status,404);
    assert.equal((await request("/parking/requests/mutate",{token:touristToken,body:{
      municipalityId:tourist.municipalityId,operation:"triage",requestId:parkingId,revision:1
    }})).status,403);
    const parkingTriaged=await request("/parking/requests/mutate",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId,operation:"triage",requestId:parkingId,revision:1}});
    assert.equal(parkingTriaged.status,200);
    assert.equal(parkingTriaged.data.status,"in_review");
    assert.equal((await request("/parking/requests/mutate",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId,operation:"triage",requestId:parkingId,revision:1}})).status,409);
    const answerParking=await request("/parking/requests/mutate",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId,operation:"answer",requestId:parkingId,revision:2,
        message:"Atendimento registrado, sem emissão de permissão ou cobrança."}});
    assert.equal(answerParking.status,200);
    assert.equal(answerParking.data.status,"answered");
    assert.equal(answerParking.data.authorizationIssued,false);
    const parkingHistory=await request("/parking/requests/history",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId,requestId:parkingId}});
    assert.deepEqual(parkingHistory.data.items.map(e=>e.code),["created","triaged","answered"]);
    assert.deepEqual(Object.keys(parkingHistory.data.items[0]).sort(),["code","createdAt","revision"]);
    assert.equal((await request("/parking/requests/mutate",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId,operation:"reject",requestId:parkingId,revision:3,
        message:"Tentativa depois de encerrado deveria falhar."}})).status,409);
    await assert.rejects(app.query("SELECT * FROM app.parking_service_requests"),e=>e.code==="42501");
    await assert.rejects(app.query("DELETE FROM app.parking_service_events WHERE FALSE"),e=>e.code==="42501");
    // Cadastro operacional: simulação, sem receita, autorização, voucher ou TTS.
    const entryData={municipalityId:tourist.municipalityId,operation:"enter",
      clientRequestId:randomUUID(),vehiclePlate:"XYZ9W87",vehicleBrand:"Marca fictícia",
      vehicleModel:"Modelo fictício",areaText:"Área de simulação"};
    const entryCreated=await request("/parking/entries/mutate",{token:parkingAdminToken,body:entryData});
    assert.equal(entryCreated.status,200);
    assert.equal(entryCreated.data.status,"present");
    assert.equal(entryCreated.data.authorizationIssued,false);
    assert.equal(entryCreated.data.paymentRegistered,false);
    assert.equal(entryCreated.data.voucherIssued,false);
    assert.equal(entryCreated.data.departureAt,null);
    assert(Number.isFinite(Date.parse(entryCreated.data.entryAt)));
    const entryId=entryCreated.data.entryId;
    assert.equal((await request("/parking/entries/mutate",{token:parkingAdminToken,body:entryData})).data.entryId,entryId);
    assert.equal((await request("/parking/entries/mutate",{token:parkingAdminToken,
      body:{...entryData,vehicleModel:"Outro modelo"}})).status,409);
    assert.equal((await request("/parking/entries/mutate",{token:parkingAdminToken,
      body:{...entryData,clientRequestId:randomUUID()}})).status,409);
    assert.equal((await request("/parking/entries/mutate",{token:touristToken,body:{
      ...entryData,clientRequestId:randomUUID()}})).status,403);
    assert.equal((await request("/parking/entries/mutate",{token:ct,body:{
      ...entryData,clientRequestId:randomUUID()}})).status,403);
    assert.equal((await request("/parking/entries/query",{token:parkingAdminToken,
      body:{municipalityId:touristOther.municipalityId}})).status,403);
    assert.equal((await request("/parking/entries/query",{token:touristToken,
      body:{municipalityId:tourist.municipalityId}})).status,403);
    const entryQuery=await request("/parking/entries/query",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId}});
    assert.equal(entryQuery.status,200);
    assert(entryQuery.data.items.some(v=>v.id===entryId&&v.vehiclePlate==="XYZ9W87"&&v.status==="present"));
    assert.equal((await request("/parking/entries/history",{token:touristToken,
      body:{municipalityId:tourist.municipalityId,entryId}})).status,404);
    assert.equal((await request("/parking/entries/history",{token:parkingAdminToken,
      body:{municipalityId:touristOther.municipalityId,entryId}})).status,404);
    const firstHistory=await request("/parking/entries/history",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId,entryId}});
    assert.deepEqual(firstHistory.data.items.map(v=>v.code),["entered"]);
    const departed=await request("/parking/entries/mutate",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId,operation:"depart",entryId,revision:1}});
    assert.equal(departed.status,200);
    assert.equal(departed.data.status,"departed");
    assert.equal(departed.data.revision,2);
    assert(Date.parse(departed.data.departureAt)>=Date.parse(departed.data.entryAt));
    assert.equal((await request("/parking/entries/mutate",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId,operation:"depart",entryId,revision:1}})).status,409);
    const historyAfter=await request("/parking/entries/history",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId,entryId}});
    assert.deepEqual(historyAfter.data.items.map(v=>v.code),["entered","departed"]);
    assert.deepEqual(Object.keys(historyAfter.data.items[0]).sort(),["code","createdAt","revision"]);
    const secondEntry=await request("/parking/entries/mutate",{token:parkingAdminToken,
      body:{...entryData,clientRequestId:randomUUID()}});
    assert.equal(secondEntry.status,200);
    assert.notEqual(secondEntry.data.entryId,entryId);
    await assert.rejects(app.query("SELECT * FROM app.parking_entry_drafts"),e=>e.code==="42501");
    await assert.rejects(app.query("DELETE FROM app.parking_entry_draft_events WHERE FALSE"),e=>e.code==="42501");
    await owner.query("UPDATE app.memberships SET active=false WHERE user_id=$1 AND municipality_id=$2",
      [parkingStaff.userId,parkingStaff.municipalityId]);
    assert.equal((await request("/parking/requests/query",{token:parkingAdminToken,
      body:{municipalityId:tourist.municipalityId,scope:"queue"}})).status,403);
    // ADM da Ouvidoria recebe TODAS as categorias, inclusive denúncias,
    // permanecendo restrito ao município da sua associação ativa.
    const normalCreated=await request("/ouvidoria/mutate",{token:ct,body:{
      ...create,category:"reclamacao",clientRequestId:randomUUID(),
      title:"Reclamação fictícia",description:"Reclamação de laboratório para auditar o acesso administrativo."
    }});
    assert.equal(normalCreated.status,200);
    const adminPage=await request("/ouvidoria/query",{token:st,
      body:{municipalityId:citizen.municipalityId,scope:"fila"}});
    assert.equal(adminPage.status,200);
    assert(adminPage.data.items.some(x=>x.id===protocolId&&x.category==="denuncia"));
    assert(adminPage.data.items.some(x=>x.id===normalCreated.data.protocolId&&x.category==="reclamacao"));
    const staffAttachments=await request("/ouvidoria/attachments/list",{token:st,
      body:{municipalityId:citizen.municipalityId,protocolId}});
    assert.equal(staffAttachments.status,200);
    assert.equal(staffAttachments.data.items[0].status,"clean");
    assert.equal((await request("/ouvidoria/query",{token:st,
      body:{municipalityId:citizen.municipalityId,scope:"fila"}})).data.items.some(x=>x.id===protocolId),true);
    const staffHistory=await request("/ouvidoria/history",{token:st,body:{municipalityId:citizen.municipalityId,protocolId}});
    assert.equal(staffHistory.status,200);assert.deepEqual(staffHistory.data.items.map(x=>x.code),["created"]);
    const adminReadLogs=await owner.query(
      "SELECT action,protocol_id FROM app.ouvidoria_admin_access_events WHERE actor_user_id=$1 ORDER BY created_at,id",
      [staff.userId]);
    assert(adminReadLogs.rows.some(x=>x.action==="queue"));
    assert(adminReadLogs.rows.some(x=>x.action==="history"&&x.protocol_id===protocolId));
    assert(adminReadLogs.rows.some(x=>x.action==="attachments"&&x.protocol_id===protocolId));
    await assert.rejects(app.query("SELECT * FROM app.ouvidoria_admin_access_events"),
      e=>e.code==="42501");
    const triage={operation:"triage",municipalityId:citizen.municipalityId,protocolId,revision:1};
    const reviewed=await request("/ouvidoria/mutate",{token:st,body:triage});
    assert.equal(reviewed.status,200);assert.equal(reviewed.data.status,"in_review");
    assert.equal((await request("/ouvidoria/mutate",{token:st,body:triage})).status,409);
    const replied=await request("/ouvidoria/mutate",{token:st,body:{operation:"respond",
      municipalityId:citizen.municipalityId,protocolId,revision:2,
      message:"A equipe municipal recebeu e analisará as condições da iluminação."}});
    assert.equal(replied.status,200);assert.equal(replied.data.status,"responded");
    const contested=await request("/ouvidoria/mutate",{token:ct,body:{operation:"contest",
      municipalityId:citizen.municipalityId,protocolId,revision:3,
      message:"A situação informada no protocolo permanece sem solução."}});
    assert.equal(contested.status,200);assert.equal(contested.data.status,"contested");
    assert.equal((await request("/ouvidoria/mutate",{token:ct,body:{operation:"contest",
      municipalityId:citizen.municipalityId,protocolId,revision:4,message:"Nova contestação fora do limite."}})).status,409);
    const another=await request("/ouvidoria/mutate",{token:st,body:{operation:"respond",
      municipalityId:citizen.municipalityId,protocolId,revision:4,
      message:"Realizada nova verificação após a contestação cadastrada."}});
    assert.equal(another.status,200);
    const closed=await request("/ouvidoria/mutate",{token:st,body:{operation:"close",
      municipalityId:citizen.municipalityId,protocolId,revision:5}});
    assert.equal(closed.status,200);assert.equal(closed.data.status,"closed");
    const archived=await request("/ouvidoria/retention/archive",{token:st,
      body:{municipalityId:citizen.municipalityId,protocolId,archived:true}});
    assert.equal(archived.status,200);
    assert.equal(archived.data.archived,true);
    assert.equal(archived.data.legalHoldPreserved,true);
    assert.equal((await request("/ouvidoria/retention/archive",{token:ot,
      body:{municipalityId:citizen.municipalityId,protocolId,archived:false}})).status,404);
    const unarchived=await request("/ouvidoria/retention/archive",{token:st,
      body:{municipalityId:citizen.municipalityId,protocolId,archived:false}});
    assert.equal(unarchived.status,200);
    assert.equal(unarchived.data.archived,false);
    assert.equal((await owner.query("SELECT legal_hold FROM app.ouvidoria_retention_hold WHERE protocol_id=$1",
      [protocolId])).rows[0].legal_hold,true);
    assert.deepEqual((await owner.query("SELECT action FROM app.ouvidoria_governance_events WHERE protocol_id=$1 ORDER BY created_at",
      [protocolId])).rows.map(v=>v.action),["archive","unarchive"]);
    assert.equal((await request("/ouvidoria/attachments/upload",{token:ct,
      body:{...attach,clientRequestId:randomUUID()}})).status,409);
    assert.equal((await request("/ouvidoria/mutate",{token:ct,body:{operation:"triage",
      municipalityId:citizen.municipalityId,protocolId,revision:6}})).status,403);
    const final=await request("/ouvidoria/query",{token:ct,
      body:{municipalityId:citizen.municipalityId,scope:"meus"}});
    const item=final.data.items.find(x=>x.id===protocolId);
    assert.equal(item.status,"closed");assert.equal(item.revision,6);assert.equal(item.contestCount,1);
    const ev=await owner.query("SELECT event_code,revision FROM app.ouvidoria_events WHERE protocol_id=$1 ORDER BY revision",[protocolId]);
    assert.deepEqual(ev.rows.map(x=>x.event_code),["created","triaged","responded","contested","responded","closed"]);
    assert.deepEqual(ev.rows.map(x=>x.revision),[1,2,3,4,5,6]);
    const completedHistory=await request("/ouvidoria/history",{token:ct,
      body:{municipalityId:citizen.municipalityId,protocolId}});
    assert.equal(completedHistory.status,200);
    assert.deepEqual(completedHistory.data.items.map(x=>x.code),
      ["created","triaged","responded","contested","responded","closed"]);
    assert(!JSON.stringify(completedHistory.data).match(/actor|userId|email|password|requestId|municipality/));
    const noticeTimeline=await request("/ouvidoria/notices/query",{token:ct,
      body:{municipalityId:citizen.municipalityId}});
    assert.equal(noticeTimeline.status,200);
    assert(noticeTimeline.data.items.length>=6);
    const sorted=noticeTimeline.data.items.map(x=>Date.parse(x.createdAt));
    assert.deepEqual(sorted,[...sorted].sort((a,b)=>b-a));
    const older=await request("/ouvidoria/notices/query",{token:ct,
      body:{municipalityId:citizen.municipalityId,after:noticeTimeline.data.items[0].id}});
    assert.equal(older.status,200);
    assert(older.data.items.length>=1);
    assert(older.data.items.every(x=>x.id!==noticeTimeline.data.items[0].id));
    await owner.query("UPDATE app.memberships SET active=false WHERE user_id=$1 AND municipality_id=$2",
      [staff.userId,staff.municipalityId]);
    assert.equal((await request("/ouvidoria/history",{token:st,
      body:{municipalityId:citizen.municipalityId,protocolId}})).status,404);
    await assert.rejects(app.query("SELECT * FROM app.ouvidoria_protocols"),e=>e.code==="42501");
    await assert.rejects(app.query("SELECT * FROM app.ouvidoria_events"),e=>e.code==="42501");
    await t.test("não habilita operações alheias, CORS ou prontidão de produção",async()=>{
      assert.equal((await request("/tts/verify")).status,503);
      assert.equal((await fetch(base+"/health/ready")).status,503);
      const forged=await fetch(base+"/api/v1/ouvidoria/query",{method:"POST",
        headers:{Origin:"https://outro.invalid",Authorization:"Bearer "+ct,"Content-Type":"application/json"},
        body:JSON.stringify({municipalityId:citizen.municipalityId,scope:"meus"})});
      assert.equal(forged.status,403);
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    await service.close();
    // Remover apenas as próprias fixtures; nunca resetar volumes.
    if(users.length){
      await owner.query("DELETE FROM app.ouvidoria_admin_access_events WHERE actor_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_attachment_access_events WHERE attachment_id IN (SELECT id FROM app.ouvidoria_attachments WHERE uploaded_by=ANY($1::uuid[]))",[users]);
      await owner.query("DELETE FROM app.ouvidoria_attachment_scan_events WHERE attachment_id IN (SELECT id FROM app.ouvidoria_attachments WHERE uploaded_by=ANY($1::uuid[]))",[users]);
      await owner.query("DELETE FROM app.ouvidoria_attachment_events WHERE actor_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_attachments WHERE uploaded_by=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.parking_entry_draft_events WHERE actor_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.parking_entry_drafts WHERE created_by=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.parking_service_events WHERE actor_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.parking_service_requests WHERE author_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.guarda_occurrence_events WHERE actor_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.guarda_occurrences WHERE created_by=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_notices WHERE recipient_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_governance_events WHERE actor_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_retention_drafts WHERE updated_by=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_archive_state WHERE updated_by=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_retention_audit WHERE actor_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_retention_hold WHERE updated_by=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_events WHERE actor_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_protocols WHERE author_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.identity_users WHERE id=ANY($1::uuid[])",[users]);
    }
    if(municipalities.size)await owner.query("DELETE FROM app.municipalities WHERE id=ANY($1::uuid[])",[[...municipalities]]);
    await app.end().catch(()=>{});
    await scannerDb.end().catch(()=>{});
    await owner.end().catch(()=>{});
  }
});
