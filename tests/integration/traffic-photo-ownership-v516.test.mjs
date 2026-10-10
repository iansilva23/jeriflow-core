import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import pg from "pg";
import {CitizenAccountsV516} from "../../apps/api/src/citizen-accounts-v516.ts";
import {TrafficPhotoOwnershipV516} from "../../apps/api/src/traffic-photo-ownership-v516.ts";

const ownerDsn=process.env.JF_V516_TEST_OWNER_DSN;
const appDsn=process.env.JF_V516_TEST_APP_DSN;
const workerDsn=process.env.JF_V516_TEST_WORKER_DSN;
if(!ownerDsn||!appDsn||!workerDsn)
  throw Error("EPHEMERAL_POSTGRES_REQUIRED");
const hash=x=>createHash("sha256").update(x).digest("hex");
const by=code=>e=>e?.code===code;
const midA=randomUUID(),midB=randomUUID();
const title="Estacionamento irregular";
const input=(mid,token,guest,photo,sha)=>[
  mid,token,guest,"Visitante fictício","1996-01-02","(88) 90000-0000",
  title,"Rua inventada em Jeri","ABC1234",
  "Foto obrigatória para denunciar estacionamento irregular",
  photo,sha
];
const photoTicket=(mid,photo,sha)=>({
  municipalityId:mid,photoId:photo,sha256:sha,byteLength:123,
  mime:"image/webp",width:64,height:48,
  stored:true,normalized:true,metadataRemoved:true,malwareScanned:false,
  evidenceApproved:false,protocolCreated:false,publicUrl:null
});
test("V5.16: reserva da foto vinculada a sessão real e gate canônico no PostgreSQL",
  {timeout:150000},async t=>{
  const owner=new pg.Client({connectionString:ownerDsn});
  const app=new pg.Client({connectionString:appDsn});
  const scanner=new pg.Client({connectionString:workerDsn});
  const accounts=new CitizenAccountsV516(appDsn);
  const reservation=new TrafficPhotoOwnershipV516(appDsn);
  try{
    await owner.connect();
    await owner.query("CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-jeriflow-test-only'");
    await owner.query("CREATE SCHEMA app");
    await owner.query("GRANT USAGE ON SCHEMA app TO jeriflow_app");
    for(const file of [
      "001-identity.sql","002-identity-security.sql","003-account-management.sql",
      "004-citizen-v516.sql","005-citizen-v516-traffic-protocol.sql",
      "006-citizen-v516-scanned-photo-worker.sql",
      "007-citizen-v516-traffic-photo-owner.sql",
    ]){
      await owner.query(readFileSync(new URL("../../infra/migrations/"+file,import.meta.url),"utf8"));
    }
    await owner.query("CREATE ROLE jeriflow_scan_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'ephemeral-scan-test-only'");
    await owner.query("GRANT jeriflow_v516_scan_worker TO jeriflow_scan_test");
    await owner.query("INSERT INTO app.municipalities(id,slug,display_name) VALUES($1,'photo-owner-a','Município Fictício A'),($2,'photo-owner-b','Município Fictício B')",[midA,midB]);
    await app.connect();await scanner.connect();

    const a=await accounts.signup({municipalityId:midA,name:"Cidadã A fictícia",
      birthDate:"1994-03-10",phone:"(88) 91111-1111",address:"Rua sem número",
      login:"cidadã.a",password:"SenhaTeste123",confirmPassword:"SenhaTeste123"});
    const b=await accounts.signup({municipalityId:midA,name:"Cidadão B fictício",
      birthDate:"1991-05-11",phone:"(88) 92222-2222",address:"Avenida inventada",
      login:"cidadao.b",password:"SenhaTeste123",confirmPassword:"SenhaTeste123"});
    const aHash=hash(a.accessToken),bHash=hash(b.accessToken);
    const photoA=randomUUID(),photoB=randomUUID(),photoGuest=randomUUID();
    const shaA=hash("fake-scanned-content-A"),shaB=hash("fake-scanned-content-B");
    const shaGuest=hash("fake-scanned-content-guest");
    const submit=values=>app.query(
      "SELECT app.citizen_v516_traffic_submit($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12) AS protocol",
      values);
    const addScan=async(photo,sha)=>scanner.query(
      "SELECT app.citizen_v516_record_scanned_media($1,$2,$3)",[midA,photo,sha]);
    const count=async()=>Number((await owner.query(
      "SELECT count(*) AS n FROM app.citizen_v516_traffic_protocols")).rows[0].n);

    await t.test("app e worker NÃO leem, inserem ou mudam tabela de propriedade",async()=>{
      for(const client of [app,scanner]){
        await assert.rejects(client.query(
          "SELECT * FROM app.citizen_v516_traffic_photo_owners"),by("42501"));
        await assert.rejects(client.query(
          "INSERT INTO app.citizen_v516_traffic_photo_owners(photo_id,municipality_id,citizen_account_id,sha256) VALUES($1,$2,$3,$4)",
          [randomUUID(),midA,randomUUID(),shaA]),by("42501"));
      }
      await assert.rejects(scanner.query(
        "SELECT app.citizen_v516_reserve_traffic_photo($1,$2,$3,$4)",
        [midA,aHash,photoA,shaA]),by("42501"));
      assert.equal(await count(),0);
    });
    await t.test("sessão inválida ou município errado não reservam",async()=>{
      await assert.rejects(app.query("SELECT app.citizen_v516_reserve_traffic_photo($1,$2,$3,$4)",
        [midA,hash("session-invalid"),photoA,shaA]),by("JF003"));
      await assert.rejects(app.query("SELECT app.citizen_v516_reserve_traffic_photo($1,$2,$3,$4)",
        [midB,aHash,photoA,shaA]),by("JF003"));
      assert.equal((await owner.query(
        "SELECT count(*) AS n FROM app.citizen_v516_traffic_photo_owners")).rows[0].n,"0");
    });
    await t.test("reserva com token validado NÃO cria gate, protocolo, nem imagem pública",async()=>{
      await reservation.reserveRegistered({
        municipalityId:midA,sessionToken:a.accessToken,
        ticket:photoTicket(midA,photoA,shaA)});
      const rows=await owner.query(
        "SELECT r.sha256,r.citizen_account_id,a.citizen_id,r.municipality_id FROM app.citizen_v516_traffic_photo_owners r JOIN app.citizen_v516_accounts a ON a.id=r.citizen_account_id");
      assert.equal(rows.rowCount,1);
      assert.equal(rows.rows[0].citizen_id,a.citizenId);
      assert.equal(rows.rows[0].sha256,shaA);
      assert.equal(rows.rows[0].municipality_id,midA);
      assert.equal(await count(),0);
      assert.equal((await owner.query(
        "SELECT count(*) AS n FROM app.citizen_v516_verified_traffic_media")).rows[0].n,"0");
    });
    await t.test("foto reservada MAS não varrida: protocolo é recusado",async()=>{
      await assert.rejects(submit(input(midA,aHash,null,photoA,shaA)),by("JF004"));
      assert.equal(await count(),0);
    });
    await t.test("reserva de outra pessoa com UUID já reservada é recusada",async()=>{
      await assert.rejects(reservation.reserveRegistered({
        municipalityId:midA,sessionToken:b.accessToken,
        ticket:photoTicket(midA,photoA,shaA)}),
        e=>e?.code==="TRAFFIC_PHOTO_OWNER_CONFLICT");
      await assert.rejects(reservation.reserveRegistered({
        municipalityId:midA,sessionToken:a.accessToken,
        ticket:photoTicket(midA,photoA,hash("altered"))}),
        e=>e?.code==="TRAFFIC_PHOTO_OWNER_CONFLICT");
      assert.equal(await count(),0);
    });
    await t.test("scanner privado registra foto, mas pessoa B NÃO pode consumir foto A",async()=>{
      await addScan(photoA,shaA);
      await assert.rejects(submit(input(midA,bHash,null,photoA,shaA)),by("JF004"));
      assert.equal((await owner.query(
        "SELECT consumed_by FROM app.citizen_v516_verified_traffic_media WHERE photo_id=$1",
        [photoA])).rows[0].consumed_by,null);
      assert.equal(await count(),0);
    });
    await t.test("pessoa A + foto A varrida geram UM protocolo SEMUS canônico",async()=>{
      const result=await submit(input(midA,aHash,null,photoA,shaA));
      const id=result.rows[0].protocol;
      assert.match(id,/^JF-[0-9]{8}-[0-9]{6,}$/);
      const resultRow=(await owner.query(
        "SELECT p.*,a.citizen_id FROM app.citizen_v516_traffic_protocols p JOIN app.citizen_v516_accounts a ON a.id=p.citizen_account_id WHERE p.id=$1",[id])).rows[0];
      assert.equal(resultRow.citizen_id,a.citizenId);
      assert.equal(resultRow.category,"Trânsito (SEMUS)");
      assert.equal(resultRow.destination,"SEMUS / Guarda de trânsito");
      assert.equal(resultRow.status,"RECEBIDA");
      assert.equal(resultRow.photo_id,photoA);
      assert.equal((await owner.query("SELECT consumed_by FROM app.citizen_v516_verified_traffic_media WHERE photo_id=$1",[photoA])).rows[0].consumed_by,id);
      assert.equal(await count(),1);
      await assert.rejects(submit(input(midA,aHash,null,photoA,shaA)),by("JF004"));
      assert.equal(await count(),1);
    });
    await t.test("uma foto escaneada mas SEM reserva não pode criar protocolo",async()=>{
      await addScan(photoB,shaB);
      await assert.rejects(submit(input(midA,bHash,null,photoB,shaB)),by("JF004"));
      assert.equal(await count(),1);
    });
    await t.test("pessoa B pode reservar sua própria foto e criar seu protocolo",async()=>{
      await reservation.reserveRegistered({
        municipalityId:midA,sessionToken:b.accessToken,
        ticket:photoTicket(midA,photoB,shaB)});
      const result=await submit(input(midA,bHash,null,photoB,shaB));
      assert.match(result.rows[0].protocol,/^JF-/);
      assert.equal(await count(),2);
    });
    await t.test("visitante com deviceId auto-declarado NÃO toma foto varrida",async()=>{
      await addScan(photoGuest,shaGuest);
      await assert.rejects(submit(input(midA,null,hash("unverified-device-id"),photoGuest,shaGuest)),by("JF003"));
      assert.equal((await owner.query(
        "SELECT consumed_by FROM app.citizen_v516_verified_traffic_media WHERE photo_id=$1",
        [photoGuest])).rows[0].consumed_by,null);
      assert.equal(await count(),2);
    });
    await t.test("banimento ou logout revoga nova reserva",async()=>{
      await owner.query("UPDATE app.citizen_v516_accounts SET moderation_status='BANNED' WHERE citizen_id=$1",[a.citizenId]);
      await assert.rejects(reservation.reserveRegistered({
        municipalityId:midA,sessionToken:a.accessToken,
        ticket:photoTicket(midA,randomUUID(),hash("banned"))}),
        e=>e?.code==="TRAFFIC_PHOTO_OWNER_DENIED");
      await owner.query("UPDATE app.citizen_v516_accounts SET moderation_status='ACTIVE' WHERE citizen_id=$1",[a.citizenId]);
      await accounts.logout(b.accessToken);
      await assert.rejects(reservation.reserveRegistered({
        municipalityId:midA,sessionToken:b.accessToken,
        ticket:photoTicket(midA,randomUUID(),hash("loggedout"))}),
        e=>e?.code==="TRAFFIC_PHOTO_OWNER_DENIED");
    });
  }finally{
    await reservation.close().catch(()=>{});
    await accounts.close().catch(()=>{});
    await scanner.end().catch(()=>{});
    await app.end().catch(()=>{});
    await owner.end().catch(()=>{});
  }
});
