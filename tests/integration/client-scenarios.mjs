import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { AuthController } from "../../packages/auth/controller.ts";
import { bearerTransport, cookieTransport } from "../../packages/auth/client.ts";
import { sessionCookie } from "../../apps/admin/lib/gateway.ts";

const storage = () => ({ value: null, async get(){return this.value;}, async set(v){this.value=v;}, async remove(){this.value=null;} });
const ready = client => { assert.equal(client.snapshot().error, undefined); assert.equal(client.snapshot().mode,"home"); };
async function startAdmin(root,api) {
  const reservation=createServer(); await new Promise(resolve=>reservation.listen(0,"127.0.0.1",resolve));
  const port=reservation.address().port; await new Promise(resolve=>reservation.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,[resolve(root,"node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",String(port)],{
    cwd:resolve(root,"apps/admin"),shell:false,stdio:"ignore",env:{...process.env,JERIFLOW_API_URL:api,JERIFLOW_ADMIN_ORIGIN:origin,NEXT_TELEMETRY_DISABLED:"1"},
  });
  let failed=false; child.on("error",()=>{failed=true;});
  async function stop(){
    if(failed||child.exitCode!==null||child.signalCode!==null)return;
    const exited=new Promise(resolve=>child.once("exit",resolve));child.kill("SIGTERM");
    const timer=setTimeout(()=>child.kill("SIGKILL"),3000);await exited;clearTimeout(timer);
  }
  try {
    for(let i=0;i<100;i++){
      if(failed||child.exitCode!==null)throw new Error("ADMIN_START_FAILED");
      try {const r=await fetch(origin+"/entrar",{signal:AbortSignal.timeout(500)});await r.body?.cancel();if(r.status===200)return{origin,stop};}catch{}
      await delay(100);
    }
    throw new Error("ADMIN_START_TIMEOUT");
  }catch(error){await stop();throw error;}
}
export async function clientScenarios(t,{root,base,account,request,requestMail,mail,otp,owner,users,emails,tenantIds}){
  for(const appId of ["cidadao","turista","guarda","fiscal-tts"]){
    await t.test(`cliente ${appId}: login, sessão restaurada, município/perfil e revogação reais`,async()=>{
      const a=await account([appId]), vault=storage();
      const client=new AuthController(bearerTransport(()=>base,vault));await client.refresh();assert.equal(client.snapshot().mode,"login");
      await client.login(a.email,a.password);ready(client);assert(vault.value);assert(!JSON.stringify(client.snapshot()).includes(vault.value));
      await client.access(a.municipalityId,`mobile:${appId}:access`);assert.equal(client.snapshot().error,undefined);
      await client.access(randomUUID(),`mobile:${appId}:access`);assert(client.snapshot().error);
      await client.access(a.municipalityId,"admin:mestre:access");assert(client.snapshot().error);
      const restored=new AuthController(bearerTransport(()=>base,vault));await restored.refresh();ready(restored);
      const previous=vault.value;await restored.logout(true);assert.equal(restored.snapshot().mode,"login");assert.equal(vault.value,null);
      assert.equal((await request("/auth/me",{token:previous})).status,401);
      await client.refresh();assert.equal(client.snapshot().mode,"login");
    });
  }
  await t.test("telas compartilhadas: confirmação de email, MFA obrigatório, códigos e recuperação de senha",async()=>{
    const a=await account(["admin-tts"],"alpha",false,false),vault=storage(),client=new AuthController(bearerTransport(()=>base,vault));
    await client.login(a.email,a.password);assert.equal(client.snapshot().mode,"verify");assert.deepEqual(client.snapshot().context.municipalities,[]);
    await client.requestEmail();assert.equal(client.snapshot().error,undefined);
    const delivered=await mail(a,"verify-email"),code=delivered.Text.match(/^([A-Za-z0-9_-]{43})$/m)?.[1];assert(code);
    await client.confirmEmail(code);assert.equal(client.snapshot().mode,"login");assert.equal(vault.value,null);
    await client.login(a.email,a.password);assert.equal(client.snapshot().mode,"enroll");
    await client.enroll(a.password,"");assert.equal(client.snapshot().error,undefined);
    const secret=client.snapshot().secret;assert(secret);
    await client.confirmEnrollment(otp(secret));assert.equal(client.snapshot().mode,"backup");assert.equal(client.snapshot().secret,undefined);
    const codes=[...client.snapshot().codes];assert.equal(codes.length,10);
    await client.acknowledgeBackups();ready(client);assert.equal(client.snapshot().codes,undefined);
    await client.rotate(a.password,codes.shift());assert.equal(client.snapshot().mode,"backup");const rotated=[...client.snapshot().codes];
    await client.acknowledgeBackups();ready(client);await client.logout();
    client.navigate("forgot");await client.requestReset(a.email);assert.equal(client.snapshot().mode,"reset");
    const resetMail=await mail(a,"reset-password"),resetCode=resetMail.Text.match(/^([A-Za-z0-9_-]{43})$/m)?.[1];assert(resetCode);
    const next=randomBytes(24).toString("base64url");
    await client.reset(resetCode,next,"different");assert.equal(client.snapshot().mode,"reset");assert(client.snapshot().error);
    await client.reset(resetCode,next,next);assert.equal(client.snapshot().mode,"login");
    await client.login(a.email,next);assert.equal(client.snapshot().mode,"mfa");assert.deepEqual(client.snapshot().context.municipalities,[]);
    const partial=vault.value;await client.challenge("invalid");assert.equal(client.snapshot().mode,"mfa");assert.equal(vault.value,partial);
    await client.challenge(rotated.shift());ready(client);assert(vault.value!==partial);await client.logout();
  });
  const admin=await startAdmin(root,base),originalFetch=globalThis.fetch; let cookie="",lastCookie="";
  // Node não tem o cookie jar de um navegador. Somente URLs relativas do adapter
  // recebem a origem e o cookie; todos os pedidos ainda atravessam o Next real.
  globalThis.fetch=async(input,init)=>{
    if(typeof input!=="string"||!input.startsWith("/api/identity/"))return originalFetch(input,init);
    const r=await originalFetch(admin.origin+input,{...init,headers:{...init?.headers,Origin:admin.origin,...(cookie?{Cookie:cookie}:{})}});
    const set=r.headers.get("set-cookie");if(set){lastCookie=set;cookie=set.includes("Max-Age=0")?"":set.split(";")[0];}
    const body=await r.clone().json();assert(!Object.hasOwn(body,"accessToken"),"Bearer nunca chega ao JavaScript do painel");
    return r;
  };
  async function page(path){const r=await originalFetch(admin.origin+path,{headers:cookie?{Cookie:cookie}:{},redirect:"manual"});return{status:r.status,html:await r.text(),headers:r.headers};}
  async function signIn(a){
    cookie="";const client=new AuthController(cookieTransport());await client.refresh();assert.equal(client.snapshot().mode,"login");
    await client.login(a.email,a.password);
    if(client.snapshot().mode==="enroll"){
      assert.equal((await page("/")).headers.get("location"),"/entrar");
      await client.enroll(a.password,"");await client.confirmEnrollment(otp(client.snapshot().secret));
      assert.equal(client.snapshot().mode,"backup");a.codes=[...client.snapshot().codes];await client.acknowledgeBackups();
    }else if(client.snapshot().mode==="mfa")await client.challenge(a.codes.shift());
    ready(client);assert(lastCookie.includes("HttpOnly"));assert(lastCookie.includes("SameSite=Strict"));return client;
  }
  try{
    await t.test("Mestre no BFF cria município e convite, destinatário ativa conta sem receber Bearer no navegador",async()=>{
      const m=await account([],null,true),client=await signIn(m),transport=cookieTransport();
      const city=await transport.request("/management/mutate",{operation:"create-municipality",slug:"bff-"+randomUUID(),displayName:"Cidade BFF fictícia",password:m.password,code:m.codes.shift()});tenantIds.add(city.municipalityId);
      const email=randomUUID()+"@example.invalid";emails.push(email);
      const invited=await transport.request("/management/mutate",{operation:"invite",municipalityId:city.municipalityId,email,roles:["guarda"],password:m.password,code:m.codes.shift()});users.push(invited.userId);
      await client.logout();const message=await mail({email},"complete-registration"),code=message.Text.match(/^([A-Za-z0-9_-]{43})$/m)?.[1];assert(code);
      const password=randomBytes(24).toString("base64url");client.navigate("activate");await client.activate(code,"Servidor fictício",password,password);
      assert.equal(client.snapshot().error,undefined);assert.equal(client.snapshot().mode,"login");assert.equal(cookie,"");
      await client.login(email,password);ready(client);assert.deepEqual(client.snapshot().context.municipalities[0].roles,["guarda"]);
      assert((await page("/paineis/mestre/contas")).html.includes("Acesso negado"));await client.logout();
    });
    for(const [panel,role] of [["mestre",null],["turismo","admin-turismo"],["cidadao","admin-cidadao"],["semus","admin-semus"],["conteudo","admin-conteudo"],["dashboard","admin-dashboard"],["studio","admin-studio"]]){
      await t.test(`painel ${panel}: cookie, MFA, autorização na rota e bloqueio de outro perfil/município`,async()=>{
        const a=await account(role?[role]:[],role?"alpha":null,!role),client=await signIn(a);
        const home=await page("/");assert.equal(home.status,200);assert(home.html.includes(`href="/paineis/${panel}`));assert(home.headers.get("cache-control").includes("no-store"));
        const query=a.municipalityId?`?municipalityId=${a.municipalityId}`:"";
        const authorized=await page(`/paineis/${panel}`+query);assert.equal(authorized.status,200);assert(authorized.html.includes("Seu acesso foi confirmado no servidor"));
        const management=await page("/paineis/mestre/contas");assert.equal(management.status,200);
        assert(management.html.includes(role ? "Acesso negado" : "Sua senha Mestre"));
        const list=await originalFetch(admin.origin+"/api/identity/management/query",{method:"POST",headers:{Cookie:cookie,Origin:admin.origin,"Content-Type":"application/json","X-JeriFlow-Request":"1"},body:JSON.stringify({kind:"accounts"})});
        assert.equal(list.status,role ? 403 : 200);assert(!(await list.text()).includes("accessToken"));
        const csrf=await originalFetch(admin.origin+"/api/identity/management/mutate",{method:"POST",headers:{Cookie:cookie,Origin:"https://evil.invalid","Content-Type":"application/json","X-JeriFlow-Request":"1"},body:"{}"});assert.equal(csrf.status,403);
        const denied=await page(`/paineis/${panel==="mestre"?"turismo":"mestre"}`+query);assert(denied.html.includes("Acesso negado"));
        if(role){const other=await page(`/paineis/${panel}?municipalityId=${randomUUID()}`);assert(other.html.includes("Acesso negado"));}
        const saved=cookie;await client.logout();assert.equal(cookie,"");assert.equal((await page("/")).headers.get("location"),"/entrar");
        cookie=saved;await client.refresh();assert.equal(client.snapshot().mode,"login");assert.equal(cookie,"");
      });
    }
    await t.test("TTS no Turismo possui permissão distinta do fiscal e é revogada na próxima navegação",async()=>{
      const a=await account(["admin-tts"]),client=await signIn(a);
      const path=`/paineis/turismo/tts?municipalityId=${a.municipalityId}`;
      assert((await page("/")).html.includes('href="'+path+'"'));
      assert((await page(path)).html.includes("Acesso confirmado;"));
      await owner.query("UPDATE app.memberships SET active=false WHERE user_id=$1",[a.userId]);
      assert((await page(path)).html.includes("Acesso negado"));await client.logout();
      const fiscal=await account(["fiscal-tts"]);await signIn(fiscal);
      assert(!(await page("/")).html.includes('href="/paineis/turismo/tts'));
      assert((await page(path)).html.includes("Acesso negado"));
    });
    await t.test("painel recupera senha pelo BFF e expiração retira o acesso mesmo com cookie antigo",async()=>{
      const a=await account(["cidadao"]),client=await signIn(a),oldCookie=cookie;
      await client.logout();client.navigate("forgot");await client.requestReset(a.email);assert.equal(client.snapshot().mode,"reset");
      const message=await mail(a,"reset-password"),code=message.Text.match(/^([A-Za-z0-9_-]{43})$/m)?.[1],next=randomBytes(24).toString("base64url");
      await client.reset(code,next,next);assert.equal(client.snapshot().mode,"login");a.password=next;
      await client.login(a.email,next);ready(client);
      await owner.query("UPDATE app.identity_sessions SET last_seen_at=clock_timestamp()-interval '16 minutes' WHERE user_id=$1",[a.userId]);
      assert.equal((await page("/")).headers.get("location"),"/entrar");await client.refresh();assert.equal(client.snapshot().mode,"login");assert.equal(cookie,"");
      cookie=oldCookie;assert.equal((await page("/")).headers.get("location"),"/entrar");cookie="";
    });
  }finally{globalThis.fetch=originalFetch;await admin.stop();}
}
