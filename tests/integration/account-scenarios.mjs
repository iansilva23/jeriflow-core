import assert from "node:assert/strict";
import { randomUUID,randomBytes } from "node:crypto";
import { digest } from "../../apps/api/src/identity-primitives.ts";
import { AuthController } from "../../packages/auth/controller.ts";
import { bearerTransport } from "../../packages/auth/client.ts";

export async function accountScenarios(t,{base,second,owner,app,account,request,login,mail,users,emails,tenantIds}) {
  const tokenFrom=message=>{const code=message.Text.match(/^([A-Za-z0-9_-]{43})$/m)?.[1];assert(code);return code;};
  const details=async userId=>(await owner.query("SELECT * FROM app.identity_users WHERE id=$1",[userId])).rows[0];
  async function municipality(label) {
    const id=randomUUID(),slug=`${label}-${id}`;
    await owner.query("INSERT INTO app.municipalities(id,slug,display_name) VALUES($1,$2,$3)",[id,slug,`Município fictício ${label}`]);
    tenantIds.add(id); return {municipalityId:id};
  }
  async function pending() {
    const email=randomUUID()+"@example.invalid";emails.push(email);
    const r=await request("/auth/registration/request",{body:{email}});assert.equal(r.status,200);assert.deepEqual(r.body,{accepted:true});
    const row=(await owner.query("SELECT id FROM app.identity_users WHERE email=$1",[email])).rows[0];assert(row);users.push(row.id);
    return{email,userId:row.id,password:randomBytes(24).toString("base64url"),code:tokenFrom(await mail({email},"complete-registration"))};
  }
  async function activate(a,code=a.code) {return request("/auth/registration/complete",{body:{token:code,displayName:"Cadastro fictício",password:a.password}});}
  async function master() {const a=await account([],null,true);a.token=await login(a);return a;}
  const mutate=(a,data,extra={})=>request("/management/mutate",{token:a.token,body:{...data,password:a.password,code:a.codes.shift(),...extra}});
  const profile=(token,municipalityId,role)=>request("/auth/public-profile",{token,body:{municipalityId,role}});
  const targetBody=(a,revision,roles=[])=>({operation:"set-membership",userId:a.userId,municipalityId:a.municipalityId,revision,roles});

  await t.test("cadastro email-first bloqueia login pendente, verifica posse e nunca cria privilégios",async()=>{
    const a=await pending(),row=await details(a.userId);assert(row.registration_pending);assert.equal(row.platform_admin,false);assert(!row.email_verified_at);
    assert.equal((await request("/auth/login",{body:{email:a.email,password:a.password}})).status,401);
    assert.equal((await request("/auth/registration/request",{body:{email:a.email,roles:["admin-tts"]}})).status,400);
    assert.equal((await activate(a)).status,200);const session=await login(a),me=await request("/auth/me",{token:session});
    assert.deepEqual(me.body.platformPermissions,[]);assert.deepEqual(me.body.municipalities,[]);assert.equal(me.body.security.emailVerified,true);
    assert.equal((await activate(a)).status,400);
    const before=await details(a.userId);assert.equal((await request("/auth/registration/request",{body:{email:a.email}})).status,200);
    const after=await details(a.userId);assert.equal(after.password_hash,before.password_hash);assert.equal(after.display_name,before.display_name);
    assert.equal((await owner.query("SELECT * FROM app.identity_actions WHERE user_id=$1",[a.userId])).rowCount,0);
  });
  await t.test("código de ativação expira, é vinculado à finalidade e concorrência consome uma vez",async()=>{
    const a=await pending();
    assert.equal((await request("/auth/password/reset",{body:{token:a.code,password:a.password}})).status,400);
    await owner.query("UPDATE app.identity_actions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[a.userId]);
    assert.equal((await activate(a)).status,400);
    await request("/auth/registration/request",{body:{email:a.email}});const latest=tokenFrom(await mail(a,"complete-registration"));assert.notEqual(latest,a.code);
    assert.equal((await activate(a)).status,400);
    const responses=await Promise.all([activate(a,latest),activate(a,latest)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
    assert.equal((await details(a.userId)).registration_pending,false);
  });
  await t.test("diretório público é limitado, pagina e esconde municípios inativos e dados de contas",async()=>{
    const fixture=[];
    for(let i=0;i<53;i++){const id=randomUUID();tenantIds.add(id);fixture.push(id);await owner.query("INSERT INTO app.municipalities(id,slug,display_name,active) VALUES($1,$2,'Cidade fictícia',$3)",[id,`directory-${id}`,i!==0]);}
    const ids=[];let after;
    do {const r=await request("/auth/municipalities",{body:after?{after}:{}});assert.equal(r.status,200);assert(r.body.items.length<=50);for(const item of r.body.items){assert.deepEqual(Object.keys(item).sort(),["displayName","id","slug"]);ids.push(item.id);}after=r.body.next;}while(after);
    assert.equal(ids.length,new Set(ids).size);assert(!ids.includes(fixture[0]));assert(fixture.slice(1).every(id=>ids.includes(id)));
  });
  await t.test("vínculo público permite apenas cidadão/turista e recusa suspensão e município indisponível",async()=>{
    const a=await account([],null),city=await municipality("join"),token=await login(a);
    for(const role of ["guarda","fiscal-tts","admin-tts","mestre"])assert.equal((await profile(token,city.municipalityId,role)).status,400);
    assert.equal((await profile(token,randomUUID(),"cidadao")).status,404);
    assert.equal((await profile(token,city.municipalityId,"cidadao")).status,200);assert.equal((await profile(token,city.municipalityId,"cidadao")).status,200);
    assert.equal((await profile(token,city.municipalityId,"turista")).status,200);
    await owner.query("UPDATE app.memberships SET active=false WHERE user_id=$1 AND role_code='cidadao'",[a.userId]);
    const suspended=await profile(token,city.municipalityId,"cidadao");assert.equal(suspended.status,403);assert.equal(suspended.body.error,"MEMBERSHIP_SUSPENDED");
    await owner.query("UPDATE app.municipalities SET active=false WHERE id=$1",[city.municipalityId]);assert.equal((await profile(token,city.municipalityId,"turista")).status,404);
  });
  await t.test("controlador dos apps conclui cadastro, login e escolha de município contra API real",async()=>{
    const city=await municipality("controller-join"),a=await pending();
    const vault={value:null,async get(){return this.value;},async set(v){this.value=v;},async remove(){this.value=null;}};
    const c=new AuthController(bearerTransport(()=>base,vault));c.navigate("activate");await c.activate(a.code,"Pessoa fictícia",a.password,a.password);
    assert.equal(c.snapshot().error,undefined);assert.equal(c.snapshot().mode,"login");await c.login(a.email,a.password);assert.equal(c.snapshot().mode,"home");
    await c.loadMunicipalities();assert.equal(c.snapshot().mode,"join");await c.join(city.municipalityId,"turista");assert.equal(c.snapshot().error,undefined);assert.equal(c.snapshot().mode,"home");
    assert(c.snapshot().context.municipalities.find(m=>m.id===city.municipalityId).permissions.includes("mobile:turista:access"));await c.logout();
  });
  await t.test("gestão recusa cidadão, fiscal, admin municipal e Mestre ainda sem MFA",async()=>{
    for(const roles of [["cidadao"],["fiscal-tts"],["admin-tts"]]) {
      const a=await account(roles),token=await login(a);
      assert.equal((await request("/management/query",{token,body:{kind:"accounts"}})).status,403);
      assert.equal((await request("/management/mutate",{token,body:{operation:"create-municipality",slug:"forbidden",displayName:"Negado",password:a.password,code:"123456"}})).status,403);
    }
    const m=await account([],null,true),partial=await request("/auth/login",{body:{email:m.email,password:m.password}});
    assert.equal((await request("/management/query",{token:partial.body.accessToken,body:{kind:"accounts"}})).status,403);
  });
  await t.test("Mestre cria município somente com senha e fator fresco e mantém unicidade",async()=>{
    const m=await master(),slug="managed-"+randomUUID(),body={operation:"create-municipality",slug,displayName:"Município gerenciado fictício"};
    assert.equal((await mutate(m,body,{password:"senha incorreta longa"})).status,401);
    assert.equal((await mutate(m,body,{code:"00000000000000000000000000000000"})).status,401);
    const code=m.codes[0],r=await mutate(m,body);assert.equal(r.status,200);tenantIds.add(r.body.municipalityId);
    assert.equal((await mutate(m,{...body,slug:"other-"+randomUUID()},{code})).status,401);
    assert.equal((await mutate(m,body)).status,409);
    const audit=await owner.query("SELECT actor_id FROM app.identity_audit WHERE event_code='municipality.created' AND municipality_id=$1",[r.body.municipalityId]);assert.equal(audit.rows[0].actor_id,m.userId);
  });
  await t.test("convite não compartilha senha, preserva TTS separado e exige MFA do administrador",async()=>{
    const m=await master(),city=await municipality("invite"),email=randomUUID()+"@example.invalid";emails.push(email);
    const body={operation:"invite",email,municipalityId:city.municipalityId,roles:["fiscal-tts","admin-tts"]};
    const r=await mutate(m,body);assert.equal(r.status,200);users.push(r.body.userId);assert(!JSON.stringify(r.body).includes("token"));
    const a={userId:r.body.userId,email,password:randomBytes(24).toString("base64url"),code:tokenFrom(await mail({email},"complete-registration"))};
    assert.equal((await activate(a)).status,200);
    const first=await request("/auth/login",{body:{email,password:a.password}});assert.equal(first.body.nextStep,"mfa_enrollment");
    assert.equal((await request(`/access?municipalityId=${city.municipalityId}&permission=tts:admin:access`,{token:first.body.accessToken})).status,403);
    const tok=await login(a),me=await request("/auth/me",{token:tok});assert.deepEqual(me.body.municipalities[0].roles,["admin-tts","fiscal-tts"]);
    assert(!me.body.municipalities[0].permissions.includes("admin:turismo:access"));
    const before=await details(a.userId);assert.equal((await mutate(m,{...body,roles:["guarda"]})).status,409);assert.equal((await details(a.userId)).password_hash,before.password_hash);
  });
  await t.test("alterar perfis preserva outro município, revoga sessões em duas instâncias e rejeita revisão antiga",async()=>{
    const m=await master(),a=await account(["cidadao"],"managed-target"),other=await municipality("managed-other");
    await owner.query("INSERT INTO app.memberships(user_id,municipality_id,role_code) VALUES($1,$2,'turista')",[a.userId,other.municipalityId]);
    const one=await login(a),two=await login(a,second),before=await details(a.userId);
    const r=await mutate(m,targetBody(a,before.management_revision,["guarda"]));assert.equal(r.status,200);
    assert.equal((await request("/auth/me",{token:one})).status,401);assert.equal((await request("/auth/me",{token:two,url:second})).status,401);
    assert.equal((await mutate(m,targetBody(a,before.management_revision,[]))).status,409);
    const next=await login(a),me=await request("/auth/me",{token:next});assert.deepEqual(me.body.municipalities.find(v=>v.id===a.municipalityId).roles,["guarda"]);assert.deepEqual(me.body.municipalities.find(v=>v.id===other.municipalityId).roles,["turista"]);
    assert.equal((await profile(next,a.municipalityId,"cidadao")).status,403);
    const query=await request("/management/query",{token:m.token,body:{kind:"accounts",municipalityId:a.municipalityId}});assert.equal(query.status,200);
    const listed=query.body.items.find(v=>v.id===a.userId);assert(listed);assert.equal(listed.revision,r.body.revision);assert(!JSON.stringify(query.body).match(/password_hash|mfa_secret|token_hash/));
    const audit=await owner.query("SELECT actor_id,target_id,municipality_id FROM app.identity_audit WHERE event_code='account.membership_changed' AND target_id=$1",[a.userId]);assert.deepEqual(audit.rows[0],{actor_id:m.userId,target_id:a.userId,municipality_id:a.municipalityId});
  });
  await t.test("concorrência de gestores não sobrescreve revisão e conta Mestre permanece protegida",async()=>{
    const m=await master(),other=await master(),a=await account(),before=await details(a.userId);
    const result=await Promise.all([mutate(m,targetBody(a,before.management_revision,["guarda"])),mutate(other,targetBody(a,before.management_revision,["turista"]))]);
    assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
    assert.equal((await mutate(m,{operation:"set-active",userId:other.userId,revision:1,active:false})).status,403);
    const query=await request("/management/query",{token:m.token,body:{kind:"accounts"}});assert(!query.body.items.some(v=>[m.userId,other.userId].includes(v.id)));
  });
  await t.test("bloquear e reativar conta preserva MFA, invalida sessões e impede login durante bloqueio",async()=>{
    const m=await master(),a=await account(["admin-tts"]),token=await login(a),before=await details(a.userId);
    const body={operation:"set-active",userId:a.userId,revision:before.management_revision,active:false};
    const blocked=await mutate(m,body);assert.equal(blocked.status,200);assert.equal((await request("/auth/me",{token})).status,401);
    assert.equal((await request("/auth/login",{body:{email:a.email,password:a.password}})).status,401);
    assert.equal((await mutate(m,{...body,revision:blocked.body.revision,active:true})).status,200);
    assert.equal((await details(a.userId)).mfa_secret,before.mfa_secret);
    assert.equal((await request("/auth/login",{body:{email:a.email,password:a.password}})).body.nextStep,"mfa_challenge");
  });
  await t.test("revisão de convite pendente invalida código antigo e suspensão impede ativação",async()=>{
    const m=await master(),a=await pending(),city=await municipality("pending"),before=await details(a.userId);
    const r=await mutate(m,{operation:"set-membership",userId:a.userId,municipalityId:city.municipalityId,revision:before.management_revision,roles:["guarda"]});assert.equal(r.status,200);
    const current=tokenFrom(await mail(a,"complete-registration"));assert.equal((await activate(a)).status,400);
    assert.equal((await mutate(m,{operation:"set-active",userId:a.userId,revision:r.body.revision,active:false})).status,200);
    assert.equal((await activate(a,current)).status,400);assert.equal((await details(a.userId)).registration_pending,true);
  });
  await t.test("funções privilegiadas não confiam em GUC e API continua sem CRUD direto de perfis",async()=>{
    const a=await account(),token=await login(a),m=await master();
    await app.query("SELECT set_config('app.actor_id',$1,false)",[m.userId]);
    try {
      await assert.rejects(app.query("SELECT app.management_query($1,'accounts',NULL,NULL)",[digest(token)]),e=>e.code==="JF003");
      await assert.rejects(app.query("SELECT app.management_mutate($1,$2::jsonb,NULL,$3)",[digest(token),JSON.stringify({operation:"set-active",userId:a.userId,revision:1,active:false}),randomUUID()]),e=>e.code==="JF003");
      await assert.rejects(app.query("SELECT app.account_actor($1,true)",[digest(token)]),e=>e.code==="42501");
      await assert.rejects(app.query("UPDATE app.memberships SET active=true WHERE user_id=$1",[a.userId]),e=>e.code==="42501");
      await assert.rejects(app.query("UPDATE app.identity_users SET registration_pending=false WHERE id=$1",[a.userId]),e=>e.code==="42501");
      const functions=await owner.query("SELECT proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.prosecdef");assert(functions.rows.length>=7);assert(functions.rows.every(f=>f.proconfig.includes("search_path=pg_catalog, app, pg_temp")));
    } finally {await app.query("SELECT set_config('app.actor_id','',false)");}
  });
}
