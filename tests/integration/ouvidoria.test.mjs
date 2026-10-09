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
    const scanned=await scanOnce({owner,identityKey:readIdentityKey(root),
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

      // Nunca liberar se o ultimo evento do scanner nao foi clean, mesmo que o
      // status do banco ainda apareca clean. O evento sintetico e removido depois.
      const retryEvent=(await owner.query(
        "INSERT INTO app.ouvidoria_attachment_scan_events(attachment_id,result,scanner_version) VALUES($1,'retry','ci-security-test') RETURNING id",
        [uploaded.data.attachmentId])).rows[0].id;
      try {
        assert.equal((await request("/ouvidoria/attachments/read-test",{token:ct,body:readBody})).status,404);
      }finally{
        await owner.query("DELETE FROM app.ouvidoria_attachment_scan_events WHERE id=$1",[retryEvent]);
      }
      // A autenticidade AES-GCM e verificada antes de qualquer resposta com bytes.
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
      const infectedScan=await scanOnce({owner,identityKey:readIdentityKey(root),socketPath:realSocket});
      assert.equal(infectedScan.status,"rejected");
      const infectedState=await owner.query("SELECT scan_status FROM app.ouvidoria_attachments WHERE id=$1",
        [infectedUpload.data.attachmentId]);
      assert.equal(infectedState.rows[0].scan_status,"rejected");
      const failedBody={...attach,clientRequestId:randomUUID(),fileName:"teste-indisponivel.pdf"};
      const failedUpload=await request("/ouvidoria/attachments/upload",{token:ct,body:failedBody});
      assert.equal(failedUpload.status,200);
      const failedScan=await scanOnce({owner,identityKey:readIdentityKey(root),
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
    const staffAttachments=await request("/ouvidoria/attachments/list",{token:st,
      body:{municipalityId:citizen.municipalityId,protocolId}});
    assert.equal(staffAttachments.status,200);
    assert.equal(staffAttachments.data.items[0].status,"clean");
    assert.equal((await request("/ouvidoria/query",{token:st,
      body:{municipalityId:citizen.municipalityId,scope:"fila"}})).data.items.some(x=>x.id===protocolId),true);
    const staffHistory=await request("/ouvidoria/history",{token:st,body:{municipalityId:citizen.municipalityId,protocolId}});
    assert.equal(staffHistory.status,200);assert.deepEqual(staffHistory.data.items.map(x=>x.code),["created"]);
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
      await owner.query("DELETE FROM app.ouvidoria_attachment_access_events WHERE attachment_id IN (SELECT id FROM app.ouvidoria_attachments WHERE uploaded_by=ANY($1::uuid[]))",[users]);
      await owner.query("DELETE FROM app.ouvidoria_attachment_scan_events WHERE attachment_id IN (SELECT id FROM app.ouvidoria_attachments WHERE uploaded_by=ANY($1::uuid[]))",[users]);
      await owner.query("DELETE FROM app.ouvidoria_attachment_events WHERE actor_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_attachments WHERE uploaded_by=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_events WHERE actor_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.ouvidoria_protocols WHERE author_user_id=ANY($1::uuid[])",[users]);
      await owner.query("DELETE FROM app.identity_users WHERE id=ANY($1::uuid[])",[users]);
    }
    if(municipalities.size)await owner.query("DELETE FROM app.municipalities WHERE id=ANY($1::uuid[])",[[...municipalities]]);
    await app.end().catch(()=>{});
    await owner.end().catch(()=>{});
  }
});
