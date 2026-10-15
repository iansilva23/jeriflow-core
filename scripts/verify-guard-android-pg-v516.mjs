/** Confere a transação real após o toque final no Android e a revogação do login. */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {ownerClient} from "./identity-database.mjs";
assert(process.env.GITHUB_ACTIONS==="true");
assert(
 (process.env.JF_NATIVE_GUARDA_SHIFT_UI_SMOKE==="1"&&
  process.env.GITHUB_REF==="refs/heads/feature/v516-guarda-shift-android-e2e-20261015")
 ||(process.env.JF_NATIVE_GUARDA_SHIFT_UI_SMOKE!=="1"&&
  process.env.GITHUB_REF==="refs/heads/feature/v516-guarda-native-login-e2e-20261012")
);
const root=fileURLToPath(new URL("..",import.meta.url));
const fixture=JSON.parse(readFileSync(join(process.env.RUNNER_TEMP,"jeriflow-guard-e2e-fixture.json"),"utf8"));
const owner=ownerClient(root);
try{
 await owner.connect();
 const row=(await owner.query("SELECT status FROM app.citizen_v516_traffic_protocols WHERE id=$1 AND municipality_id=$2",
  [fixture.protocolId,fixture.municipalityId])).rows;
 assert.equal(row.length,1);
 assert.equal(row[0].status,"FINALIZADA");
 const result=(await owner.query(
  "SELECT guard_user_id,service_result,service_action FROM app.guard_v516_service_rounds WHERE protocol_id=$1",
  [fixture.protocolId])).rows;
 assert.equal(result.length,1);
 assert.equal(result[0].guard_user_id,fixture.guardUserId);
 assert.equal(result[0].service_result,"Veículo encontrado");
 assert.equal(result[0].service_action,"Orientação realizada");
 const events=(await owner.query(
  "SELECT action FROM app.guard_v516_service_events WHERE protocol_id=$1 ORDER BY created_at",
  [fixture.protocolId])).rows;
 assert.deepEqual(events.map(x=>x.action),["ACCEPTED","FINISHED"]);
 const sessions=(await owner.query(
  "SELECT count(*)::integer AS total FROM app.identity_sessions WHERE user_id=$1",
  [fixture.guardUserId])).rows[0].total;
 assert.equal(sessions,0,"Logout deve revogar sessão da conta de teste");
 if(process.env.JF_NATIVE_GUARDA_SHIFT_UI_SMOKE==="1"){
  const shiftEvents=(await owner.query(
   "SELECT on_shift FROM app.guard_v516_shift_events WHERE municipality_id=$1 AND guard_user_id=$2 ORDER BY created_at,request_id",
   [fixture.municipalityId,fixture.guardUserId])).rows;
  assert.deepEqual(shiftEvents.map(row=>row.on_shift),[false,true],
   "Dois toques distintos devem persistir FORA e EM SERVIÇO no PostgreSQL");
  const shiftPresence=(await owner.query(
   "SELECT on_shift FROM app.guard_v516_shift_presence WHERE municipality_id=$1 AND guard_user_id=$2",
   [fixture.municipalityId,fixture.guardUserId])).rows;
  assert.deepEqual(shiftPresence.map(row=>row.on_shift),[true],
   "Estado final do plantão persistido deve ser EM SERVIÇO");
 }
 const report={passed:true,scope:"ephemeral-fixture-only",steps:[
  "login-real",...(process.env.JF_NATIVE_GUARDA_SHIFT_UI_SMOKE==="1"?["plantao-dois-toques-pg"]:[]),"atendimento","finalizacao-pg","historico-pg","logout-revogado"
 ]};
 const dir=join(root,"artifacts/native/android/guarda");
 mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,"authenticated-pg-check.json"),JSON.stringify(report,null,2)+"\n");
 console.log("GUARDA_ANDROID_PG_VERIFIED");
}finally{await owner.end().catch(()=>{});}
