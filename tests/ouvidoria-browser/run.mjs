import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { migrateIdentity, ownerClient } from "../../scripts/identity-database.mjs";
import { provisionIdentity } from "../../scripts/identity-provision.mjs";
import { decodeBase32, totp } from "../../apps/api/src/identity-security.ts";

// Apenas ambiente isolado; sem HAR, trace, vídeo, armazenamento de sessão,
// credenciais em artefatos ou reinicialização destrutiva de volumes.
const root=fileURLToPath(new URL("../..",import.meta.url));
const artifact=resolve(root,"artifacts/ouvidoria-browser");
const origin="http://127.0.0.1:3000",api="http://127.0.0.1:3001";
const nonce=randomBytes(6).toString("hex");
const stages=["Acesso anônimo bloqueado","Sessões de cidadãos recusadas no painel",
  "MFA obrigatório para servidor","Criação de protocolo pela API do cidadão",
  "Equipe visualiza apenas fila autorizada","Equipe assume análise pela interface",
  "Equipe responde pela interface","Equipe encerra atendimento pela interface",
  "Município vizinho não acessa fila","Resposta protegida contra CSRF",
  "Revogação de perfil remove acesso","Trilha de auditoria e isolamento preservados"];
const report={scope:"ouvidoria-browser-e2e",environment:"isolated-development",browser:"Chromium",
  sourceCommit:process.env.GITHUB_SHA??"local",runId:process.env.GITHUB_RUN_ID??null,
  startedAt:new Date().toISOString(),productionApproved:false,vpsValidated:false,physicalDevicesTested:false,
  cases:stages.map((name,i)=>({id:i+1,name,status:"BLOCKED"})),errors:[]};
const childProcesses=[],userIds=[],municipalityIds=new Set();
let owner,browser,adminPage,stage=0;
function assert(condition,code){if(!condition)throw new Error(code);}
async function save(){report.updatedAt=new Date().toISOString();report.totals={
  pass:report.cases.filter(x=>x.status==="PASS").length,fail:report.cases.filter(x=>x.status==="FAIL").length,
  blocked:report.cases.filter(x=>x.status==="BLOCKED").length};
  await writeFile(resolve(artifact,"report.json"),JSON.stringify(report,null,2)+"\n");}
async function screenshot(page,id){
  if(!page||page.isClosed())return;
  const name=String(id).padStart(2,"0")+".png";
  await page.screenshot({path:resolve(artifact,name),fullPage:true,animations:"disabled",
    mask:[page.locator("input"),page.locator("textarea"),page.locator(".secret"),page.locator(".recovery"),
      page.locator(".ouvidoria-item p")]});
  return name;
}
async function step(id,action,page=adminPage){
  stage=id;
  try{await action();report.cases[id-1].status="PASS";
    if(page)report.cases[id-1].screenshot=await screenshot(page,id);}
  catch(e){report.cases[id-1].status="FAIL";report.errors.push({case:id,reason:String(e?.message??e).slice(0,180)});
    throw e;
  } finally{await save();console.log("Ouvidoria browser control",id,report.cases[id-1].status);}
}
async function start(label,args,cwd=root){
  const child=spawn(process.execPath,args,{cwd,stdio:["ignore","ignore","ignore"],shell:false,
    env:{...process.env,NODE_ENV:"development",NEXT_TELEMETRY_DISABLED:"1",
      JERIFLOW_ADMIN_ORIGIN:origin,JERIFLOW_API_URL:api}});
  childProcesses.push({label,child});
  child.on("error",()=>{});
}
async function waitServer(url){
  const until=Date.now()+45000;
  while(Date.now()<until){
    assert(childProcesses.every(p=>p.child.exitCode===null&&p.child.signalCode===null),"SERVER_EXITED");
    try{const response=await fetch(url,{signal:AbortSignal.timeout(1000)});
      await response.body?.cancel();if(response.ok)return;}catch{}
    await delay(300);
  }
  throw new Error("SERVER_START_TIMEOUT");
}
async function http(path,body,token){
  const response=await fetch(api+"/api/v1"+path,{method:"POST",headers:{"Content-Type":"application/json",
    ...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  return {status:response.status,body:await response.json()};
}
async function person(city,roles){
  const email=randomUUID()+"@example.invalid",password=randomBytes(24).toString("base64url");
  const created=await provisionIdentity(root,{email,password,displayName:"Pessoa fictícia para homologação",
    platformAdmin:false,municipalities:[{slug:city.slug,displayName:city.name,roles}]});
  userIds.push(created.userId);const municipalityId=created.municipalities[0].id;
  municipalityIds.add(municipalityId);
  // A verificação direta do email só existe no fixture efêmero, com conta falsa.
  await owner.query("UPDATE app.identity_users SET email_verified_at=clock_timestamp() WHERE id=$1",[created.userId]);
  return {email,password,municipalityId,id:created.userId};
}
async function login(person,completeMfa=false){
  let response=await http("/auth/login",{email:person.email,password:person.password});
  assert(response.status===200,"LOGIN_FAILED");
  let token=response.body.accessToken;
  if(completeMfa){
    assert(response.body.nextStep==="mfa_enrollment","MFA_ENROLLMENT_NOT_REQUIRED");
    const enrollment=await http("/auth/mfa/enroll/start",{password:person.password},token);
    assert(enrollment.status===200&&typeof enrollment.body.secret==="string","MFA_START_FAILED");
    const challenge=totp(decodeBase32(enrollment.body.secret),Math.floor(Date.now()/30000));
    response=await http("/auth/mfa/enroll/confirm",{code:challenge},token);
    assert(response.status===200,"MFA_CONFIRM_FAILED");
    token=response.body.accessToken;
  }
  assert(typeof token==="string"&&token.length===43,"TOKEN_MISSING");
  return token;
}
async function pageWith(token){
  const context=await browser.newContext({viewport:{width:1300,height:900},locale:"pt-BR"});
  await context.route("**/*",route=>{
    const url=new URL(route.request().url());return url.origin===origin?route.continue():route.abort();
  });
  if(token)await context.addCookies([{name:"jeriflow_admin_session",value:token,url:origin,
    httpOnly:true,sameSite:"Strict",secure:false}]);
  const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on("pageerror",e=>{report.errors.push({case:stage,reason:"BROWSER_RUNTIME_ERROR"});});
  return page;
}
async function bff(page,path,body){
  return page.evaluate(async({path,body})=>{
    const r=await fetch("/api/identity"+path,{method:"POST",headers:{"Content-Type":"application/json",
      "X-JeriFlow-Request":"1"},body:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  },{path,body});
}
async function authorizeUi(page,municipalityId){
  await page.goto(origin+"/paineis/cidadao/ouvidoria?municipalityId="+municipalityId);
  await page.getByRole("heading",{name:"Ouvidoria · Atendimento"}).waitFor();
}
await mkdir(artifact,{recursive:true});await save();
try{
  assert(process.env.NODE_ENV!=="production","NO_PRODUCTION");
  await migrateIdentity(root);owner=ownerClient(root);await owner.connect();
  const cityA={slug:"ouv-ui-a-"+nonce,name:"Município fictício Alfa "+nonce},
    cityB={slug:"ouv-ui-b-"+nonce,name:"Município fictício Beta "+nonce};
  const citizen=await person(cityA,["cidadao"]),staff=await person(cityA,["admin-cidadao"]),
    other=await person(cityB,["admin-cidadao"]);
  await start("api",["--env-file=.env.local","apps/api/src/main.ts"]);await waitServer(api+"/health/dependencies");
  await start("admin",[resolve(root,"node_modules/next/dist/bin/next"),"start",
    "--hostname","127.0.0.1","--port","3000"],resolve(root,"apps/admin"));
  await waitServer(origin+"/entrar");
  browser=await chromium.launch({headless:true});
  const anonymous=await pageWith();
  await step(1,async()=>{
    await anonymous.goto(origin+"/paineis/cidadao/ouvidoria?municipalityId="+staff.municipalityId);
    await anonymous.getByRole("heading",{name:"Bem-vindo de volta"}).waitFor();
    assert(anonymous.url().includes("/entrar"),"ANON_ACCESS_GRANT");
  },anonymous);
  const citizenToken=await login(citizen),cpage=await pageWith(citizenToken);
  await step(2,async()=>{
    await authorizeUi(cpage,citizen.municipalityId);
    await cpage.getByRole("alert").filter({hasText:"Acesso negado"}).waitFor();
    assert((await bff(cpage,"/ouvidoria/query",{municipalityId:citizen.municipalityId,scope:"fila"})).status===403,
      "CITIZEN_ACCESSED_ADMIN_QUEUE");
  },cpage);
  let pending=await http("/auth/login",{email:staff.email,password:staff.password});
  assert(pending.status===200&&pending.body.nextStep==="mfa_enrollment","ADMIN_MFA_NOT_REQUIRED");
  const unready=await pageWith(pending.body.accessToken);
  await step(3,async()=>{
    await unready.goto(origin+"/paineis/cidadao/ouvidoria?municipalityId="+staff.municipalityId);
    await unready.waitForURL("**/entrar");
    assert(unready.url().includes("/entrar"),"MFA_BYPASS_PAGE");
    assert((await bff(unready,"/ouvidoria/query",{municipalityId:staff.municipalityId,scope:"fila"})).status===403,
      "MFA_BYPASS_BFF");
  },unready);
  const adminToken=await login(staff,true);
  const created=await http("/ouvidoria/mutate",{operation:"create",municipalityId:citizen.municipalityId,
    clientRequestId:randomUUID(),category:"solicitacao",title:"Iluminação de teste na quadra",
    description:"Texto fictício para validar o atendimento de um protocolo nesta homologação."},citizenToken);
  await step(4,async()=>assert(created.status===200&&created.body.status==="open","CREATE_FAILED"),cpage);
  const protocolId=created.body.protocolId;
  adminPage=await pageWith(adminToken);
  await step(5,async()=>{
    await authorizeUi(adminPage,staff.municipalityId);
    await adminPage.getByRole("heading",{name:"Iluminação de teste na quadra"}).waitFor();
    assert(await adminPage.getByRole("button",{name:"Assumir análise"}).count()===1,"ADMIN_QUEUE_EMPTY");
    assert(!(await adminPage.evaluate(()=>document.cookie.includes("jeriflow_admin_session"))),"TOKEN_IN_SCRIPT_COOKIE");
    assert(await adminPage.evaluate(()=>localStorage.length===0&&sessionStorage.length===0),"TOKEN_IN_WEB_STORAGE");
  });
  await step(6,async()=>{
    await adminPage.getByRole("button",{name:"Assumir análise"}).click();
    await adminPage.getByRole("heading",{name:"Assumir análise"}).waitFor();
    await adminPage.getByRole("button",{name:"Confirmar alteração"}).click();
    await adminPage.getByText("Em análise",{exact:true}).waitFor();
  });
  await step(7,async()=>{
    await adminPage.getByRole("button",{name:"Responder"}).click();
    await adminPage.getByLabel("Resposta ao cidadão").fill("A equipe registrou a análise da solicitação fictícia para teste.");
    await adminPage.getByRole("button",{name:"Confirmar alteração"}).click();
    await adminPage.getByText("Respondido",{exact:true}).waitFor();
    await adminPage.getByRole("button",{name:"Ver anexos"}).click();
    await adminPage.getByText("Anexos protegidos (máximo 5)").waitFor();
    const pdf=Buffer.concat([Buffer.from("%PDF-1.7\\n"),Buffer.alloc(90,65)]);
    await adminPage.getByLabel("Enviar evidência (JPEG, PNG ou PDF, até 1 MB)")
      .setInputFiles({name:"evidencia-teste.pdf",mimeType:"application/pdf",buffer:pdf});
    await adminPage.getByRole("button",{name:"Enviar para quarentena"}).click();
    await adminPage.getByText("Em quarentena",{exact:false}).first().waitFor();
    assert(!(await adminPage.getByRole("link",{name:/baixar|download/i}).count()),"QUARANTINE_DOWNLOAD_LINK");
  });
  await step(8,async()=>{
    await adminPage.getByRole("button",{name:"Encerrar protocolo"}).click();
    await adminPage.getByRole("button",{name:"Confirmar alteração"}).click();
    await adminPage.getByText("Encerrado",{exact:true}).waitFor();
    await adminPage.getByRole("button",{name:"Ver histórico"}).click();
    await adminPage.getByRole("list",{name:"Histórico do protocolo"}).waitFor();
    await adminPage.getByText("Atendimento encerrado").waitFor();
    await adminPage.getByText("Protocolo recebido").waitFor();
    await adminPage.getByRole("button",{name:"Ocultar histórico"}).click();
  });
  const otherToken=await login(other,true),otherPage=await pageWith(otherToken);
  await step(9,async()=>{
    await authorizeUi(otherPage,staff.municipalityId);
    await otherPage.getByRole("alert").filter({hasText:"Acesso negado"}).waitFor();
    assert((await bff(otherPage,"/ouvidoria/query",{municipalityId:staff.municipalityId,scope:"fila"})).status===403,
      "CROSS_TENANT_QUEUE");
    await authorizeUi(otherPage,other.municipalityId);
    await otherPage.getByText("Nenhum protocolo nesta página.").waitFor();
    assert(!(await otherPage.getByText("Iluminação de teste na quadra").count()),"CROSS_TENANT_DATA_EXPOSED");
  },otherPage);
  await step(10,async()=>{
    const forbidden=await fetch(origin+"/api/identity/ouvidoria/query",{method:"POST",
      headers:{"Content-Type":"application/json","Cookie":"jeriflow_admin_session="+adminToken,
        "Origin":"https://evil.invalid","Host":"127.0.0.1:3000","X-JeriFlow-Request":"1"},
      body:JSON.stringify({municipalityId:staff.municipalityId,scope:"fila"})});
    assert(forbidden.status===403,"CROSS_SITE_REQUEST_ACCEPTED");await forbidden.body?.cancel();
  });
  await step(11,async()=>{
    await owner.query("UPDATE app.memberships SET active=false WHERE user_id=$1 AND municipality_id=$2 AND role_code='admin-cidadao'",
      [staff.id,staff.municipalityId]);
    await authorizeUi(adminPage,staff.municipalityId);
    await adminPage.getByRole("alert").filter({hasText:"Acesso negado"}).waitFor();
    assert((await bff(adminPage,"/ouvidoria/query",{municipalityId:staff.municipalityId,scope:"fila"})).status===403,
      "REVOKED_ROLE_STILL_ALLOWED");
  });
  await step(12,async()=>{
    const data=await owner.query("SELECT status,revision FROM app.ouvidoria_protocols WHERE id=$1",[protocolId]);
    assert(data.rows.length===1&&data.rows[0].status==="closed"&&data.rows[0].revision===4,"FINAL_STATE_INVALID");
    const events=await owner.query("SELECT event_code FROM app.ouvidoria_events WHERE protocol_id=$1 ORDER BY revision",[protocolId]);
    assert(JSON.stringify(events.rows.map(e=>e.event_code))===JSON.stringify(["created","triaged","responded","closed"]),
      "AUDIT_SEQUENCE_INVALID");
    const outside=await http("/ouvidoria/query",{municipalityId:other.municipalityId,scope:"fila"},otherToken);
    assert(outside.status===200&&!outside.body.items.some(x=>x.id===protocolId),"CROSS_TENANT_READ");
    assert(report.errors.length===0,"BROWSER_RUNTIME_ERRORS");
  });
} catch(e){
  report.failure={case:stage,reason:String(e?.message??e).slice(0,180)};
  process.exitCode=1;
} finally{
  await browser?.close().catch(()=>{});
  for(const p of childProcesses){if(p.child.exitCode===null)p.child.kill("SIGTERM");}
  await delay(400);
  for(const p of childProcesses)if(p.child.exitCode===null)p.child.kill("SIGKILL");
  if(owner){
    // Limpa somente fixtures desta execução; nunca reseta o banco completo.
    try{
      await owner.query("DELETE FROM app.ouvidoria_attachment_scan_events WHERE attachment_id IN (SELECT id FROM app.ouvidoria_attachments WHERE uploaded_by=ANY($1::uuid[]))",[userIds]);
      await owner.query("DELETE FROM app.ouvidoria_attachment_events WHERE actor_user_id=ANY($1::uuid[])",[userIds]);
      await owner.query("DELETE FROM app.ouvidoria_attachments WHERE uploaded_by=ANY($1::uuid[])",[userIds]);
      await owner.query("DELETE FROM app.ouvidoria_events WHERE actor_user_id=ANY($1::uuid[])",[userIds]);
      await owner.query("DELETE FROM app.ouvidoria_protocols WHERE author_user_id=ANY($1::uuid[])",[userIds]);
      await owner.query("DELETE FROM app.identity_audit WHERE actor_id=ANY($1::uuid[]) OR target_id=ANY($1::uuid[])",[userIds]);
      await owner.query("DELETE FROM app.identity_users WHERE id=ANY($1::uuid[])",[userIds]);
      await owner.query("DELETE FROM app.municipalities WHERE id=ANY($1::uuid[])",[[...municipalityIds]]);
    }catch(e){process.exitCode=1;report.errors.push({case:stage,reason:"FIXTURE_CLEANUP_FAILED"});}
    await owner.end().catch(()=>{});
  }
  report.finishedAt=new Date().toISOString();report.allPassed=report.cases.every(c=>c.status==="PASS")&&report.errors.length===0;
  await save();
  if(!report.allPassed)process.exitCode=1;
  console.log(JSON.stringify({scope:report.scope,totals:report.totals,allPassed:report.allPassed,
    vpsValidated:false,physicalDevicesTested:false}));
}
