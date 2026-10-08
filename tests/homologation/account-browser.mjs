import { chromium } from 'playwright';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { provisionIdentity } from '../../scripts/identity-provision.mjs';
import { migrateIdentity } from '../../scripts/identity-database.mjs';

// Standalone browser acceptance suite. No traces, HAR, videos, storage-state,
// database resets, throttle resets, external email, or production endpoints.
const root = fileURLToPath(new URL('../..', import.meta.url));
const out = resolve(root, 'artifacts/block4-browser');
const origin = 'http://127.0.0.1:3000', api = 'http://127.0.0.1:3001', mailpit = 'http://127.0.0.1:58025';
const run = randomBytes(6).toString('hex');
const secrets = new Set(), responses = [], violations = [], browserErrors = [], processes = [];
const observations = [], pendingResponses = new Set();
let browser, currentPage, currentId = 0, phase = 'preparation';
function secret(s) { if (typeof s === 'string' && s) secrets.add(s); return s; }
function clean(value) {
  let text = String(value);
  for (const s of [...secrets].sort((a,b)=>b.length-a.length)) text = text.split(s).join('[REDACTED]');
  return text.replace(/(?:postgres(?:ql)?|redis):\/\/\S+/gi, '[PRIVATE_CONNECTION]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[REDACTED_LONG_VALUE]').slice(0,4000);
}
function check(ok, code) { if (!ok) throw new Error(code); }
function account(label) { return { email:`${label}-${run}@example.invalid`, displayName:`Conta fictícia ${label}`, password:secret(randomBytes(32).toString('base64url')), codes:[] }; }
const master=account('mestre'), ttsMaster=account('mestre-tts'), pendingMaster=account('mestre-sem-mfa');
const member=account('gestor'), fiscal=account('fiscal'), ttsAdmin=account('administrador-tts');
const cityA={name:`Município fictício Alfa ${run}`,slug:`alfa-${run}`}, cityB={name:`Município fictício Beta ${run}`,slug:`beta-${run}`}, cityC={name:`Município fictício Gama ${run}`,slug:`gama-${run}`};
const titles = [
 'Abrir login','Entrar como Mestre','Confirmar email e configurar MFA pela interface','Entrar no Painel Mestre','Abrir Contas e municípios','Cadastrar município fictício','Persistir município após recarregar',
 'Convidar conta fictícia pelo Mestre','Conceder perfil inicialmente permitido','Destinatário define sua senha; Mestre não recebe credencial','Buscar código somente no Mailpit','Inserir código pela interface','Definir nome e senha próprios','Recusar reutilização do convite',
 'Entrar na conta convidada','Conferir município autorizado','Mostrar somente módulos permitidos','Bloquear área não autorizada','Voltar ao Mestre','Alterar perfis municipais','Revogar sessão anterior','Entrar novamente','Permitir novo perfil','Bloquear perfil removido','Preservar outro município',
 'Bloquear conta pelo Mestre','Recusar sessão já aberta','Recusar novo login da conta bloqueada','Reativar conta','Preservar vínculos anteriores','Preservar MFA',
 'Criar contas fictícias Fiscal e Administração TTS','Distinguir permissões Fiscal e Administração TTS','Administração TTS não concede Turismo','Fiscal não recebe administração TTS','TTS não concede outras áreas',
 'Recusar novamente convite consumido','Recusar código inválido','Bloquear município não autorizado','Bloquear usuário comum no Mestre','Recusar gestão administrativa sem MFA pronto','Recusar revisão antiga sem sobrescrever edição','Não expor credenciais indevidamente em UI/API'
];
const report = {
 scope:'block4-browser-acceptance', sourceCommit:process.env.GITHUB_SHA??'local', runId:process.env.GITHUB_RUN_ID??null,
 startedAt:new Date().toISOString(), environment:'isolated-development', browser:'Chromium', productionApproved:false,
 vpsValidated:false, physicalDevicesTested:false, mode:'real browser UI with explicit API adjuncts for authorization',
 criteria:titles.map((title,i)=>({id:i+1,title,status:'BLOCKED'})), observations, errors:browserErrors,
};
async function saveReport() {
  report.finishedAt=new Date().toISOString(); report.phase=phase;
  report.totals=Object.fromEntries(['PASS','FAIL','BLOCKED'].map(s=>[s,report.criteria.filter(c=>c.status===s).length]));
  report.allCriticalPassed=report.totals.PASS===43 && violations.length===0 && browserErrors.length===0;
  report.responseChecks={count:responses.length,violations:[...new Set(violations)]};
  await writeFile(resolve(out,'report.json'),cleanJson(report));
}
function cleanJson(value) {
  return JSON.stringify(value,(k,v)=> {
    // Commit/checksum provenance is public metadata, not a credential.
    if (['sourceCommit','sha256'].includes(k) && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(v)) return v;
    return typeof v==='string'?clean(v):v;
  },2)+'\n';
}
async function capture(id,page) {
  if (!page || page.isClosed()) return;
  const name=`${String(id).padStart(2,'0')}.png`;
  const bytes=await page.screenshot({fullPage:true,animations:'disabled',mask:[page.locator('input:not([type="checkbox"])'),page.locator('.secret'),page.locator('.recovery')]});
  await writeFile(resolve(out,name),bytes);
  return {file:name,sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function step(id,action,page=currentPage,method='browser UI') {
  currentId=id; phase=`control-${id}`;
  try { await action(); report.criteria[id-1]={...report.criteria[id-1],id,title:titles[id-1],status:'PASS',method,screenshot:await capture(id,page)}; }
  catch(e) { report.criteria[id-1]={id,title:titles[id-1],status:'FAIL',method,error:clean(e?.message??e),screenshot:await capture(id,page).catch(()=>undefined)}; throw e; }
  finally { await saveReport(); console.log(`Control ${id}: ${report.criteria[id-1].status}`); }
}
function inspectResponse(path,data) {
  const allowedSecret=path==='/auth/mfa/enroll/start';
  const allowedCodes=['/auth/mfa/enroll/confirm','/auth/mfa/recovery-codes'].includes(path);
  function walk(value,parent='') {
    if (!value || typeof value!=='object') return;
    for (const [key,v] of Object.entries(value)) {
      const location=parent?`${parent}.${key}`:key;
      if (/^(secret|uri|recoveryCodes)$/i.test(key)) {
        if ((key==='secret'||key==='uri')&&allowedSecret) {secret(v);continue;}
        if(key==='recoveryCodes'&&allowedCodes&&Array.isArray(v)){v.forEach(secret);continue;}
        violations.push(`${path}:${location}`);
      }
      if (/password|password_hash|passwordHash|accessToken|refreshToken|token_hash|mfa_secret|secret_encrypted|auth_version/i.test(key)) violations.push(`${path}:${location}`);
      walk(v,location);
    }
  }
  walk(data); responses.push({path,statusKeys:Object.keys(data??{})});
}
async function newPage() {
  const context=await browser.newContext({viewport:{width:1280,height:1000},locale:'pt-BR'});
  // All app requests stay on the three dedicated loopback services.
  await context.route('**/*',route=>[origin,api,mailpit].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  context.on('page',observePage);
  return context.newPage();
}
function observePage(page) {
  page.setDefaultTimeout(12000);
  page.on('pageerror',e=>browserErrors.push(clean(e.message)));
  page.on('response',res=>{
    if(!res.url().startsWith(origin+'/api/identity/'))return;
    const p=res.json().then(data=>inspectResponse(new URL(res.url()).pathname.replace('/api/identity',''),data)).catch(()=>{violations.push('BFF_RESPONSE_NOT_JSON');}).finally(()=>pendingResponses.delete(p));
    pendingResponses.add(p);
  });
}
const heading=(page,name)=>page.getByRole('heading',{name,exact:true});
async function visible(page,name) { await heading(page,name).waitFor(); }
async function ready(page) { await page.locator('[aria-busy="false"]').first().waitFor(); }
async function login(page,a) {
  await page.goto(origin+'/entrar');await visible(page,'Bem-vindo de volta');
  await page.getByLabel('Email',{exact:true}).fill(a.email);
  await page.getByLabel('Senha (15 a 128 caracteres)',{exact:true}).fill(a.password);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();await ready(page);
}
async function mailCode(a,purpose) {
  const deadline=Date.now()+45000;
  while(Date.now()<deadline) {
    const found=await fetch(mailpit+'/api/v1/search?query='+encodeURIComponent(`to:${a.email} tag:${purpose}`),{signal:AbortSignal.timeout(3000)});
    check(found.ok,'MAILPIT_SEARCH_FAILED');const data=await found.json();
    if(data.messages?.length) {
      const res=await fetch(mailpit+'/api/v1/message/'+encodeURIComponent(data.messages[0].ID),{signal:AbortSignal.timeout(3000)});
      check(res.ok,'MAILPIT_MESSAGE_FAILED');const message=await res.json();
      const code=message.Text?.match(/^([A-Za-z0-9_-]{43})$/m)?.[1];check(code,'MAILPIT_CODE_MISSING');
      observations.push({kind:'mailpit-delivery',recipient:a.email,purpose});return secret(code);
    }
    await delay(800);
  }
  throw new Error('MAILPIT_DELIVERY_TIMEOUT');
}
async function verifyEmail(page,a) {
  await visible(page,'Confirme seu email');await page.getByRole('button',{name:'Enviar ou reenviar código',exact:true}).click();await ready(page);
  const code=await mailCode(a,'verify-email');await page.getByLabel('Código recebido',{exact:true}).fill(code);
  await page.getByRole('button',{name:'Confirmar email',exact:true}).click();await visible(page,'Bem-vindo de volta');
  await login(page,a);
}
// Independent RFC 6238 generator; enrollment secret comes only from the UI.
function otp(encoded) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';
  for(const c of encoded)bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');
  const key=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const h=createHmac('sha1',key).update(counter).digest(),offset=h[19]&15;
  return secret(String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0'));
}
async function enroll(page,a) {
  await visible(page,'Proteja sua conta');await page.getByLabel('Senha (15 a 128 caracteres)',{exact:true}).fill(a.password);
  await page.getByRole('button',{name:'Preparar autenticador',exact:true}).click();await page.locator('.secret').waitFor();
  a.mfaSecret=secret(await page.locator('.secret').innerText());
  await page.getByLabel('Código de seis dígitos do novo autenticador',{exact:true}).fill(otp(a.mfaSecret));
  await page.getByRole('button',{name:'Ativar proteção',exact:true}).click();await visible(page,'Guarde seus códigos');
  a.codes=(await page.locator('.recovery code').allTextContents()).map(secret);check(a.codes.length===10,'RECOVERY_CODE_COUNT');
  await page.getByLabel('Guardei os dez códigos em um lugar seguro.',{exact:true}).check();
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await visible(page,'Conta verificada');
}
function factor(a) {const value=a.codes.shift();check(value,'NO_UNUSED_RECOVERY_CODE');return value;}
async function completeLogin(page,a) {
  await login(page,a);
  await visible(page,'Segunda confirmação');await page.getByLabel('Código do autenticador ou de recuperação',{exact:true}).fill(factor(a));
  await page.getByRole('button',{name:'Confirmar acesso',exact:true}).click();await visible(page,'Conta verificada');
}
async function bff(page,path,body) {
  const result=await page.evaluate(async({path,body})=>{
    const res=await fetch('/api/identity'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-JeriFlow-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:res.status,data:await res.json()};
  },{path,body});return result;
}
async function access(page,city,permission) {
  const cookie=(await page.context().cookies()).find(c=>c.name==='jeriflow_admin_session');check(cookie,'SESSION_COOKIE_MISSING');secret(cookie.value);
  const res=await fetch(api+'/api/v1/access?'+new URLSearchParams({municipalityId:city.id,permission}),{headers:{Authorization:'Bearer '+cookie.value},signal:AbortSignal.timeout(10000)});
  const data=await res.json();inspectResponse('/access',data);return {status:res.status,data};
}
async function panel(page,name,city,allowed) {
  await page.goto(origin+'/paineis/'+name+(city?'?municipalityId='+city.id:''));
  if(allowed) {check(!(await page.getByText(/Acesso negado/).count()),'UNEXPECTED_PANEL_DENIAL');check(page.url().includes('/paineis/'),'UNEXPECTED_PANEL_REDIRECT');}
  else await page.getByText(/Acesso negado/).waitFor();
}
async function manage(page) {await page.goto(origin+'/paineis/mestre/contas');await visible(page,'Contas e municípios');await page.locator('.management[aria-busy="false"]').waitFor();}
async function selectOperation(page,op) {await ready(page);await page.getByLabel(/^Operação/).selectOption(op);}
async function submitManagement(page,a,status=200) {
  // Fill credentials last: selection changes intentionally clear them.
  await page.getByLabel('Sua senha Mestre',{exact:true}).fill(a.password);
  await page.getByLabel('Código atual do autenticador ou recuperação',{exact:true}).fill(factor(a));
  await page.getByLabel('Conferi a conta, o município e os perfis. Confirmo esta alteração.',{exact:true}).check();
  const wait=page.waitForResponse(r=>r.url()===origin+'/api/identity/management/mutate'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Confirmar alteração',exact:true}).click();const res=await wait;
  check(res.status()===status,`MANAGEMENT_STATUS_${res.status()}_EXPECTED_${status}`);
  const body=await res.json();await ready(page);
  if(status===200)await page.getByRole('status').filter({hasText:'Alteração confirmada'}).waitFor();
  return body;
}
async function createCity(page,a,city) {
  await selectOperation(page,'create-municipality');await page.getByLabel('Nome do município',{exact:true}).fill(city.name);
  await page.getByLabel('Identificador do município',{exact:true}).fill(city.slug);
  const data=await submitManagement(page,a);city.id=data.municipalityId;check(city.id,'CITY_ID_MISSING');
}
const roleLabels={'admin-cidadao':'Admin Cidadão/Ouvidoria','admin-semus':'Admin SEMUS','admin-conteudo':'Admin Conteúdo','fiscal-tts':'Fiscal TTS','admin-tts':'TTS dentro do Admin Turismo'};
async function roles(page,list) {
  const box=page.getByRole('group',{name:'Perfis autorizados neste município',exact:true});
  for(const c of await box.getByRole('checkbox').all())await c.uncheck();
  for(const role of list)await page.getByLabel(roleLabels[role],{exact:true}).check();
}
async function invite(page,a,target,city,list) {
  await selectOperation(page,'invite');await page.getByLabel('Email do destinatário',{exact:true}).fill(target.email);
  await page.getByLabel(/^Município/).selectOption(city.id);await roles(page,list);
  check(await page.locator('input[type=password]').count()===1,'UNEXPECTED_RECIPIENT_PASSWORD_FIELD');
  target.id=(await submitManagement(page,a)).userId;check(target.id,'INVITED_ACCOUNT_ID_MISSING');
}
async function editRoles(page,target,city,list) {
  await selectOperation(page,'set-membership');await page.getByLabel(/^Conta/).selectOption(target.id);
  await page.getByLabel(/^Município/).selectOption(city.id);await roles(page,list);
}
async function activate(page,a,code=a.activationCode,expected=200) {
  await page.goto(origin+'/entrar');await visible(page,'Bem-vindo de volta');
  await page.getByRole('button',{name:'Ativar conta com convite',exact:true}).click();
  await page.getByLabel('Código recebido',{exact:true}).fill(code);
  await fillActivation(page,a,expected);
}
async function fillActivation(page,a,expected=200) {
  await page.getByLabel('Nome de exibição',{exact:true}).fill(a.displayName);
  await page.getByLabel('Senha (15 a 128 caracteres)',{exact:true}).fill(a.password);
  await page.getByLabel('Confirme a senha',{exact:true}).fill(a.password);
  const wait=page.waitForResponse(r=>r.url()===origin+'/api/identity/auth/registration/complete');
  await page.getByRole('button',{name:'Ativar conta',exact:true}).click();const res=await wait;
  check(res.status()===expected,`ACTIVATION_STATUS_${res.status()}_EXPECTED_${expected}`);
  if(expected===200)await visible(page,'Bem-vindo de volta');
  else await page.getByRole('alert').filter({hasText:'Este código venceu ou já foi usado'}).waitFor();
}
async function startProcess(label,args,cwd=root) {
  const child=spawn(process.execPath,args,{cwd,env:{...process.env,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',JERIFLOW_API_URL:api,JERIFLOW_ADMIN_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
  const lines=[];let bytes=0;
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if(bytes<150000){lines.push(chunk.toString());bytes+=chunk.length;}});
  processes.push({child,label,lines});child.on('error',()=>lines.push('PROCESS_START_FAILED'));
}
async function waitHttp(url) {
  const deadline=Date.now()+45000;
  while(Date.now()<deadline) {
    try {const res=await fetch(url,{signal:AbortSignal.timeout(2000)});await res.body?.cancel();if(res.ok)return;}catch{}
    check(processes.every(p=>p.child.exitCode===null),'SERVER_EXITED_DURING_START');await delay(400);
  }
  throw new Error('SERVER_START_TIMEOUT');
}
await mkdir(out,{recursive:true});await saveReport();
try {
  check(process.env.NODE_ENV!=='production','DEVELOPMENT_ONLY');
  await migrateIdentity(root);
  for(const a of [master,ttsMaster,pendingMaster])a.id=(await provisionIdentity(root,{email:a.email,password:a.password,displayName:a.displayName,platformAdmin:true,municipalities:[]})).userId;
  await startProcess('api',['--env-file=.env.local','apps/api/src/main.ts']);await waitHttp(api+'/health/dependencies');
  await startProcess('admin',[resolve(root,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3000'],resolve(root,'apps/admin'));await waitHttp(origin+'/entrar');
  browser=await chromium.launch({headless:true});
  const m=await newPage();currentPage=m;
  await step(1,async()=>{await m.goto(origin+'/entrar');await visible(m,'Bem-vindo de volta');});
  await step(2,async()=>{await login(m,master);await visible(m,'Confirme seu email');});
  await step(3,async()=>{await verifyEmail(m,master);await enroll(m,master);});
  await step(4,async()=>{await m.getByRole('link',{name:'Abrir minhas áreas',exact:true}).click();await m.getByRole('link',{name:/^Admin Mestre/}).click();await visible(m,'Admin Mestre');});
  await step(5,async()=>{await m.getByRole('link',{name:'Gerenciar contas e municípios',exact:true}).click();await visible(m,'Contas e municípios');await ready(m);});
  await step(6,async()=>{
    const slug=m.getByLabel('Identificador do município',{exact:true});
    for(const [value,expected] of [['cidade-teste',true],['ab',true],['cidade com espaco',false],['Cidade',false],['cidade_teste',false],['-cidade',false],['cidade-',false]]) {
      await slug.fill(value);check(await slug.evaluate(el=>el.checkValidity())===expected,'SLUG_BROWSER_VALIDATION');
    }
    observations.push({kind:'regression',test:'municipality identifier browser validity',cases:7,status:'PASS'});
    await createCity(m,master,cityA);
  });
  await step(7,async()=>{await m.reload();await ready(m);await selectOperation(m,'invite');check(await m.getByLabel(/^Município/).locator('option').filter({hasText:cityA.name}).count()===1,'CITY_NOT_PERSISTED');});
  phase='fixtures-secondary-municipalities';await createCity(m,master,cityB);await createCity(m,master,cityC);
  await step(8,()=>invite(m,master,member,cityA,['admin-cidadao']));
  await step(9,async()=>{const r=await bff(m,'/management/query',{kind:'accounts'});check(r.status===200,'DIRECTORY_FAILED');const target=r.data.items.find(x=>x.id===member.id);check(target?.memberships.some(x=>x.municipalityId===cityA.id&&x.role==='admin-cidadao'&&x.active),'INITIAL_ROLE_MISSING');});
  await step(10,async()=>{check(await m.locator('input[type=password]').count()===1,'RECIPIENT_PASSWORD_FIELD');check((await m.getByLabel('Sua senha Mestre',{exact:true}).inputValue())==='','MASTER_CREDENTIAL_NOT_CLEARED');check(!violations.length,'SENSITIVE_RESPONSE');});
  await step(11,async()=>{member.activationCode=await mailCode(member,'complete-registration');},m,'Mailpit local API; activation code retained only in memory');
  const u=await newPage();currentPage=u;
  await step(12,async()=>{await u.goto(origin+'/entrar');await visible(u,'Bem-vindo de volta');await u.getByRole('button',{name:'Ativar conta com convite',exact:true}).click();await u.getByLabel('Código recebido',{exact:true}).fill(member.activationCode);});
  await step(13,()=>fillActivation(u,member));
  const negative=await newPage();
  await step(14,()=>activate(negative,member,member.activationCode,400),negative);
  await step(15,async()=>{await login(u,member);await enroll(u,member);await u.getByRole('link',{name:'Abrir minhas áreas',exact:true}).click();});
  await step(16,async()=>{await u.getByRole('heading',{name:cityA.name,exact:true}).waitFor();check(!(await u.getByRole('heading',{name:cityC.name,exact:true}).count()),'UNAUTHORIZED_CITY_VISIBLE');});
  await step(17,async()=>{check(await u.getByRole('link',{name:/^Admin Cidadão/}).count()===1,'AUTHORIZED_MODULE_MISSING');check(await u.locator('a[href*="/paineis/"]').count()===1,'UNEXPECTED_MODULE');});
  await step(18,()=>panel(u,'semus',cityA,false));
  currentPage=m;
  await step(19,()=>manage(m));
  // A second legitimate membership proves per-municipality preservation.
  phase='fixtures-second-membership';await editRoles(m,member,cityB,['admin-conteudo']);await submitManagement(m,master);
  const old=await newPage();await completeLogin(old,member);await old.goto(origin+'/');
  await step(20,async()=>{await editRoles(m,member,cityA,['admin-semus']);await submitManagement(m,master);});
  await step(21,async()=>{const r=await bff(old,'/auth/me');check(r.status===401,'OLD_SESSION_REMAINS_VALID');await old.goto(origin+'/');await visible(old,'Bem-vindo de volta');},old,'browser UI + BFF session rejection');
  const fresh=await newPage();currentPage=fresh;
  await step(22,()=>completeLogin(fresh,member));
  await step(23,()=>panel(fresh,'semus',cityA,true));
  await step(24,()=>panel(fresh,'cidadao',cityA,false));
  await step(25,async()=>{await panel(fresh,'conteudo',cityB,true);const r=await bff(fresh,'/auth/me');check(r.data.municipalities.find(x=>x.id===cityB.id)?.permissions.includes('admin:conteudo:access'),'OTHER_CITY_CHANGED');});
  let beforeBlock;
  await step(26,async()=>{beforeBlock=(await bff(fresh,'/auth/me')).data;await manage(m);await selectOperation(m,'set-active');await m.getByLabel(/^Conta/).selectOption(member.id);await submitManagement(m,master);},m);
  await step(27,async()=>{check((await bff(fresh,'/auth/me')).status===401,'BLOCKED_SESSION_VALID');await fresh.goto(origin+'/');await visible(fresh,'Bem-vindo de volta');});
  await step(28,async()=>{await login(fresh,member);await fresh.getByRole('alert').filter({hasText:'Email ou senha incorretos'}).waitFor();});
  await step(29,async()=>{await selectOperation(m,'set-active');await m.getByLabel(/^Conta/).selectOption(member.id);await submitManagement(m,master);},m);
  await step(30,async()=>{await completeLogin(fresh,member);const after=(await bff(fresh,'/auth/me')).data;check(JSON.stringify(after.municipalities)===JSON.stringify(beforeBlock.municipalities),'MEMBERSHIPS_CHANGED_ON_REACTIVATION');});
  await step(31,async()=>{const r=await bff(fresh,'/auth/me');check(r.data.security.mfaEnabled&&r.data.security.nextStep==='ready','MFA_LOST');await fresh.goto(origin+'/entrar');await visible(fresh,'Conta verificada');await fresh.getByRole('button',{name:'Trocar autenticador',exact:true}).waitFor();});
  const mt=await newPage(), f=await newPage(), t=await newPage();
  await step(32,async()=>{
    await login(mt,ttsMaster);await verifyEmail(mt,ttsMaster);await enroll(mt,ttsMaster);await manage(mt);
    for(const a of [fiscal,ttsAdmin]){await invite(mt,ttsMaster,a,cityA,[a===fiscal?'fiscal-tts':'admin-tts']);a.activationCode=await mailCode(a,'complete-registration');}
    await activate(f,fiscal);await login(f,fiscal);await visible(f,'Conta verificada');
    await activate(t,ttsAdmin);await login(t,ttsAdmin);await enroll(t,ttsAdmin);
  },mt);
  await step(33,async()=>{check((await access(f,cityA,'mobile:fiscal-tts:access')).status===200,'FISCAL_ACCESS_MISSING');check((await access(t,cityA,'tts:admin:access')).status===200,'TTS_ADMIN_MISSING');check((await access(t,cityA,'mobile:fiscal-tts:access')).status===403,'TTS_ADMIN_GOT_FISCAL');await panel(t,'turismo/tts',cityA,true);},t,'browser UI + authenticated API authorization');
  await step(34,async()=>{check((await access(t,cityA,'admin:turismo:access')).status===403,'TTS_GOT_TOURISM');await panel(t,'turismo',cityA,false);},t);
  await step(35,async()=>{check((await access(f,cityA,'tts:admin:access')).status===403,'FISCAL_GOT_ADMIN');await panel(f,'turismo/tts',cityA,false);},f);
  await step(36,async()=>{for(const p of [f,t])for(const permission of ['admin:cidadao:access','admin:semus:access','admin:conteudo:access','admin:dashboard:access','admin:studio:access'])check((await access(p,cityA,permission)).status===403,'TTS_UNEXPECTED_PERMISSION');await panel(t,'mestre',undefined,false);},t,'browser UI + authenticated API authorization');
  await step(37,()=>activate(negative,member,member.activationCode,400),negative);
  await step(38,()=>activate(negative,member,secret(randomBytes(32).toString('base64url')),400),negative);
  await step(39,async()=>{check((await access(fresh,cityC,'admin:semus:access')).status===403,'CROSS_CITY_ACCESS');await panel(fresh,'semus',cityC,false);},fresh);
  await step(40,async()=>{await panel(fresh,'mestre',undefined,false);check((await bff(fresh,'/management/query',{kind:'accounts'})).status===403,'NON_MASTER_DIRECTORY_ACCESS');},fresh);
  const unready=await newPage();
  await step(41,async()=>{await login(unready,pendingMaster);await verifyEmail(unready,pendingMaster);await visible(unready,'Proteja sua conta');const r=await bff(unready,'/management/mutate',{operation:'create-municipality',slug:`forbidden-${run}`,displayName:'Município fictício recusado',password:pendingMaster.password,code:'000000'});check(r.status===403&&r.data.error==='FORBIDDEN','UNREADY_MASTER_WRITE');await unready.goto(origin+'/paineis/mestre/contas');await visible(unready,'Proteja sua conta');},unready,'browser UI + negative BFF administrative request');
  await step(42,async()=>{
    const stale=await m.context().newPage();stale.setDefaultTimeout(12000);await manage(m);await manage(stale);
    await editRoles(stale,member,cityA,['admin-cidadao']);
    await editRoles(m,member,cityA,['admin-conteudo']);await submitManagement(m,master);
    const result=await submitManagement(stale,master,409);check(result.error==='STALE_REVISION','WRONG_CONFLICT');
    await stale.getByRole('alert').filter({hasText:'Esta conta foi alterada por outra operação'}).waitFor();
    const latest=(await bff(m,'/management/query',{kind:'accounts'})).data.items.find(x=>x.id===member.id);
    check(latest.memberships.some(x=>x.municipalityId===cityA.id&&x.role==='admin-conteudo'&&x.active),'STALE_WRITE_OVERWROTE_CHANGE');
    report.criteria[41].conflictScreenshot=await capture('42-conflict',stale);
  },m);
  await step(43,async()=>{
    await Promise.all([...pendingResponses]);check(responses.length>30,'INSUFFICIENT_RESPONSE_COVERAGE');check(!violations.length,'SENSITIVE_RESPONSE_FIELD');check(!browserErrors.length,'BROWSER_RUNTIME_ERROR');
    const cookies=await m.context().cookies();check(cookies.filter(c=>c.name==='jeriflow_admin_session').every(c=>c.httpOnly&&c.sameSite==='Strict'),'UNPROTECTED_COOKIE');
    for(const p of [m,t,f]){
      const text=await p.locator('body').innerText();for(const a of [master,member,ttsMaster,fiscal,ttsAdmin])check(!text.includes(a.password),'PASSWORD_RENDERED');
      check(await p.evaluate(()=>localStorage.length===0&&sessionStorage.length===0),'BROWSER_STORAGE_USED');
    }
    observations.push({kind:'intentional-secret-display',note:'MFA enrollment and one-time recovery codes are expected UI flows; screenshots mask these areas. No trace/HAR/storage state saved.'});
  },m,'observed BFF/API responses + DOM/storage/cookie controls');
  phase='completed';
} catch(e) {
  report.failure={phase,control:currentId||null,error:clean(e?.message??e)};process.exitCode=1;
  console.error(`Acceptance stopped at ${phase}; sanitized evidence preserved.`);
} finally {
  await Promise.all([...pendingResponses]);
  if(browser)await browser.close().catch(()=>{});
  for(const p of processes)p.child.kill('SIGTERM');
  await delay(500);
  for(const p of processes){if(p.child.exitCode===null)p.child.kill('SIGKILL');await writeFile(resolve(out,p.label+'.log'),clean(p.lines.join('')));}
  await saveReport();
  if(!report.allCriticalPassed)process.exitCode=1;
  console.log(JSON.stringify({scope:report.scope,totals:report.totals,allCriticalPassed:report.allCriticalPassed,vpsValidated:false,physicalDevicesTested:false}));
}
