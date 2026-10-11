import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import pg from "pg";

const ownerDsn=process.env.JF_V516_TEST_OWNER_DSN;
const appDsn=process.env.JF_V516_TEST_APP_DSN;
if(!ownerDsn||!appDsn)throw Error("EPHEMERAL_POSTGRES_REQUIRED");
const sha=x=>createHash("sha256").update(x).digest("hex");
const by=code=>e=>e?.code===code;
const mid=randomUUID(),otherMid=randomUUID();
const token=randomBytes(32).toString("base64url");
const secondToken=randomBytes(32).toString("base64url");
const outsiderToken=randomBytes(32).toString("base64url");
const entryAgo=hours=>new Date(Date.now()-hours*3600000).toISOString();
const payload=(days=1,overrides={})=>({
 plate:"ABC1D23",brand:"Toyota",model:"Etios",year:2024,
 entryAt:entryAgo(3),days,
 responsible:"Cliente fictício",tourists:["Cliente fictício","Pessoa acompanhante"],
 hotel:"Pousada fictícia",document:"123000000",phone:"88000000000",
 notes:"Somente teste sem clientes reais",
 noRefundAcknowledged:days>1,paymentMethod:"PIX",...overrides
});
const command=(app,func,args)=>app.query(
 "SELECT app."+func+"("+args.map((_,i)=>"$"+(i+1)).join(",")+") AS result",args);
test("V5.16 estacionamento: cadastro, diárias, pagamento MANUAL, extensões e saídas com PostgreSQL real",
 {timeout:120000},async t=>{
 const owner=new pg.Client({connectionString:ownerDsn});
 const app=new pg.Client({connectionString:appDsn});
 try{
  await owner.connect();
  await owner.query(
   "CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-jeriflow-test-only'");
  await owner.query("CREATE SCHEMA app");
  await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
  for(const f of ["001-identity.sql","002-identity-security.sql",
      "003-account-management.sql","020-parking-v516-register-extensions-exit.sql"])
    await owner.query(readFileSync(
      new URL("../../infra/migrations/"+f,import.meta.url),"utf8"));
  await owner.query(
   "INSERT INTO app.municipalities(id,slug,display_name) "+
   "VALUES($1,'parking-test-alpha','Prefeitura Teste A'),($2,'parking-test-beta','Prefeitura Teste B')",
   [mid,otherMid]);
  async function mkUser(email,session,role,municipality=mid){
   const id=randomUUID();
   await owner.query(
    "INSERT INTO app.identity_users(id,email,display_name,password_hash,"+
    "email_verified_at,mfa_secret,mfa_version) "+
    "VALUES($1,$2,'Operador de Teste','synthetic-only',clock_timestamp(),'synthetic-mfa',1)",
    [id,email]);
   await owner.query("INSERT INTO app.memberships(user_id,municipality_id,role_code) VALUES($1,$2,$3)",
    [id,municipality,role]);
   await owner.query(
    "INSERT INTO app.identity_sessions(token_hash,user_id,auth_version,"+
    "mfa_version,mfa_verified_at) "+
    "VALUES($1,$2,1,1,clock_timestamp())",
    [sha(session),id]);
   return id;
  }
  const admin=await mkUser("admin-parking@example.invalid",token,"admin-turismo");
  await mkUser("other-parking@example.invalid",secondToken,"admin-turismo",otherMid);
  await mkUser("outsider@example.invalid",outsiderToken,"turista");
  await app.connect();
  const register=(tk,municipality,request,data)=>
    command(app,"parking_v516_register",[municipality,sha(tk),request,data]);
  const extend=(tk,municipality,request,record,days,method="PIX")=>
    command(app,"parking_v516_extend",
      [municipality,sha(tk),request,record,days,method]);
  const exit=(tk,municipality,request,record,mode,reason="")=>
    command(app,"parking_v516_confirm_exit",
      [municipality,sha(tk),request,record,mode,reason]);
  const count=async(table)=>Number((await owner.query(
    "SELECT count(*)::integer AS n FROM app."+table)).rows[0].n);
  const read=async id=>(await owner.query(
    "SELECT * FROM app.parking_v516_registrations WHERE id=$1",[id])).rows[0];
  const request=randomUUID();
  let first;
  await t.test("nenhuma tarifa ativada -> recusa cadastro e movimento",async()=>{
   await assert.rejects(register(token,mid,request,payload()),by("JF004"));
   assert.equal(await count("parking_v516_registrations"),0);
   assert.equal(await count("parking_v516_movements"),0);
  });
  await owner.query(
   "INSERT INTO app.parking_v516_tariffs(municipality_id,daily_rate_cents,enabled,approved_by) "+
   "VALUES($1,4000,true,$2)",
   [mid,admin]);
  await t.test("regras de cobrança: reconhecer antecipação e campos mínimos",async()=>{
   for(const data of [
    payload(3,{noRefundAcknowledged:false}),
    payload(1,{hotel:""}),
    payload(1,{tourists:[]}),
    payload(1,{paymentMethod:"gateway-externo"}),
    payload(0),payload(3651),
    payload(1,{plate:"DROP TABLE"}),
   ])await assert.rejects(register(token,mid,randomUUID(),data));
   assert.equal(await count("parking_v516_registrations"),0);
  });
  await t.test("sem perfil Turismo, sem MFA, município errado: negar antes de gravar",async()=>{
   await assert.rejects(register(outsiderToken,mid,randomUUID(),payload()),by("JF003"));
   await assert.rejects(register(token,otherMid,randomUUID(),payload()),by("JF003"));
   await assert.rejects(register(secondToken,mid,randomUUID(),payload()),by("JF003"));
   assert.equal(await count("parking_v516_registrations"),0);
  });
  await t.test("cadastro V5.16 cria ocupação + pagamento já recebido, NÃO TTS",async()=>{
   first=(await register(token,mid,request,payload())).rows[0].result;
   assert.match(first,/^[0-9a-f-]{36}$/);
   const reg=await read(first);
   assert.equal(reg.plate,"ABC1D23");
   assert.equal(reg.lodging,"Pousada fictícia");
   assert.equal(reg.paid_days,1);
   assert.equal(Number(reg.daily_rate_cents),4000);
   assert.equal(Number(reg.total_paid_cents),4000);
   assert.equal(reg.prepaid_multi_day,false);
   assert.equal(new Date(reg.paid_until).getTime()-new Date(reg.entry_at).getTime(),86400000);
   assert.equal(reg.manual_exit_at,null);
   const mov=(await owner.query(
    "SELECT kind,amount_cents,added_days,method FROM app.parking_v516_movements WHERE registration_id=$1",
    [first])).rows[0];
   assert.deepEqual({...mov,amount_cents:Number(mov.amount_cents)},
    {kind:"INITIAL",amount_cents:4000,added_days:1,method:"PIX"});
  });
  await t.test("repetição da requisição não cria segundo veículo nem outro pagamento",async()=>{
   const repeated=(await register(token,mid,request,payload())).rows[0].result;
   assert.equal(repeated,first);
   assert.equal(await count("parking_v516_registrations"),1);
   assert.equal(await count("parking_v516_movements"),1);
  });
  await t.test("sem SELECT/UPDATE/DELETE diretamente pelo app",async()=>{
   await assert.rejects(app.query("SELECT * FROM app.parking_v516_registrations"),by("42501"));
   await assert.rejects(app.query(
    "UPDATE app.parking_v516_registrations SET paid_days=300 WHERE id=$1",[first]),by("42501"));
   await assert.rejects(app.query("SELECT * FROM app.parking_v516_movements"),by("42501"));
  });
  await t.test("extensão acrescenta dias ao limite pago, sem cobrar automaticamente",async()=>{
   const before=await read(first),xId=randomUUID();
   const response=await extend(token,mid,xId,first,2,"DEBITO");
   assert.equal(new Date(response.rows[0].result).getTime()-
    new Date(before.paid_until).getTime(),2*86400000);
   const reg=await read(first);
   assert.equal(reg.paid_days,3);
   assert.equal(Number(reg.total_paid_cents),12000);
   assert.equal(await count("parking_v516_movements"),2);
   const again=await extend(token,mid,xId,first,2,"DEBITO");
   assert.equal(new Date(again.rows[0].result).getTime(),
    new Date(reg.paid_until).getTime());
   assert.equal(await count("parking_v516_movements"),2);
  });
  await t.test("saída precoce com várias diárias não pode usar saída NORMAL",async()=>{
   await assert.rejects(
    exit(token,mid,randomUUID(),first,"NORMAL"),by("JF005"));
   const done=await exit(token,mid,randomUUID(),first,"EARLY_NO_REFUND");
   assert(done.rows[0].result);
   const r=await read(first);
   assert.equal(r.exit_mode,"EARLY_NO_REFUND");
   assert.equal(Number(r.total_paid_cents),12000);
   assert.equal(await count("parking_v516_movements"),2);
   await assert.rejects(extend(token,mid,randomUUID(),first,1),by("JF005"));
  });
  await t.test("inadimplência NÃO produz saída nem cobrança; tolerância motivada gera saída física",async()=>{
   const req=randomUUID();
   const older=(await register(token,mid,req,payload(1,{
    plate:"XYZ9Z99",entryAt:entryAgo(50)
   }))).rows[0].result;
   const overdue=await read(older);
   assert(new Date(overdue.paid_until).getTime()<Date.now());
   await assert.rejects(exit(token,mid,randomUUID(),older,"NORMAL"),by("JF005"));
   await assert.rejects(exit(token,mid,randomUUID(),older,"TOLERANCE",""),by("JF005"));
   assert.equal((await read(older)).manual_exit_at,null);
   await exit(token,mid,randomUUID(),older,"TOLERANCE","Tolerância concedida após análise");
   assert.equal((await read(older)).exit_mode,"TOLERANCE");
   assert.equal(await count("parking_v516_movements"),3,
    "nenhuma nova cobrança por tolerância");
  });
  await t.test("contestação por saída antecipada só encaminha, sem efetuar estorno",async()=>{
   const id=(await register(token,mid,randomUUID(),payload(3,{
    plate:"QAZ2A22",noRefundAcknowledged:true
   }))).rows[0].result;
   const x=await exit(token,mid,randomUUID(),id,"EARLY_ESCALATED",
     "Cliente contestou e pediu análise da coordenação");
   assert(x.rows[0].result);
   assert.equal((await read(id)).exit_mode,"EARLY_ESCALATED");
   const audits=await owner.query(
    "SELECT * FROM app.parking_v516_exit_audit WHERE registration_id=$1",[id]);
   assert.equal(audits.rowCount,1);
   assert.equal(Number((await read(id)).total_paid_cents),12000);
   assert.equal(await count("parking_v516_movements"),4);
   assert.equal((await read(id)).manual_exit_at!==null,true);
  });
  await t.test("revogar sessão administrativa bloqueia novas operações",async()=>{
   await owner.query("DELETE FROM app.identity_sessions WHERE token_hash=$1",[sha(token)]);
   await assert.rejects(register(token,mid,randomUUID(),payload()),by("JF003"));
   assert.equal(await count("parking_v516_registrations"),3);
  });
 }finally{await app.end().catch(()=>{});await owner.end().catch(()=>{});}
});
