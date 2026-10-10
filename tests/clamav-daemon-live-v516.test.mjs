import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:net";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {
  commandClamdV516,parseClamdDailyVersionV516,parseSignedDailyVersionV516,
  assertClamdLoadsOfficialDailyV516,reloadClamdAndVerifyV516
} from "../apps/api/src/clamav-daemon-live-v516.ts";

const matches=code=>error=>error?.code===code;
async function mockDaemon(responses,run){
 const tmp=await mkdtemp(join(tmpdir(),"jf516-clamd-version-"));
 const socket=join(tmp,"private.sock");
 const seen=[];
 const server=createServer(client=>{
  let input="";
  client.on("data",data=>{
   input+=data.toString("utf8");
   const n=input.indexOf("\0");
   if(n<0)return;
   const command=input.slice(0,n);
   seen.push(command);
   const reply=responses[command]??"COMMAND UNAVAILABLE";
   client.end(Buffer.from(reply+"\0"));
  });
 });
 try{
  await new Promise((ok,reject)=>server.once("error",reject).listen(socket,ok));
  await run(socket,seen);
 }finally{
  await new Promise(ok=>server.close(ok));
  await rm(tmp,{recursive:true,force:true});
 }
}
test("V5.16: ClamAV VERSION lê a versão daily carregada, não a versão do executável",()=>{
 assert.equal(parseClamdDailyVersionV516("ClamAV 1.5.4/28108/Sat Oct 10 06:24:00 2026"),28108);
 assert.equal(parseClamdDailyVersionV516("ClamAV 0.103.9/26801/Mon May 01 12:15:00 2023"),26801);
});
test("V5.16: rejeita VERSION incompleta, desativada ou injetada",()=>{
 for(const response of ["COMMAND UNAVAILABLE","", "ClamAV 1.5.4/0/date","ClamAV 1.5.4/notnum/date",
   "ClamAV 1.5.4/28108/date\nCOMMANDS", "ClamAV 1.5.4/28108/date/extra"]){
  assert.throws(()=>parseClamdDailyVersionV516(response),matches("CLAMD_UNVERIFIED_REPLY"));
 }
});
test("V5.16: versão daily local só pode vir de sigtool com verificação OK",()=>{
 assert.equal(parseSignedDailyVersionV516("File: daily.cvd\nVersion: 28108\nVerification OK.\n"),28108);
 for(const info of ["Version: 28108\nVerification FAILED\n","Version: 28108",
   "Version: 0\nVerification OK.\n","Version: notnum\nVerification OK.\n"]){
  assert.throws(()=>parseSignedDailyVersionV516(info),matches("CLAMD_DAILY_UNVERIFIED"));
 }
});
test("V5.16: comandos usam socket Unix privado e delimitador nulo",async()=>{
 await mockDaemon({"zPING":"PONG","zVERSION":"ClamAV 1.5.4/28108/Sat Oct 10 2026","zRELOAD":"RELOADING"},
   async (socket,seen)=>{
    assert.equal(await commandClamdV516(socket,"PING"),"PONG");
    assert.match(await commandClamdV516(socket,"VERSION"),/28108/);
    assert.equal(await commandClamdV516(socket,"RELOAD"),"RELOADING");
    assert.deepEqual(seen,["zPING","zVERSION","zRELOAD"]);
   });
});
test("V5.16: socket inexistente ou relativo falha fechado",async()=>{
 await assert.rejects(commandClamdV516("relative.sock","VERSION"),matches("CLAMD_NOT_CONFIGURED"));
 await assert.rejects(commandClamdV516("/tmp/jf516-absent-version.sock","VERSION"),
   matches("CLAMD_UNAVAILABLE"));
});
test("V5.16: não considera a versão correta quando as bases assinadas não existem",async()=>{
 await mockDaemon({"zVERSION":"ClamAV 1.5.4/28108/Sat Oct 10 2026"},
   async socket=>{
    await assert.rejects(assertClamdLoadsOfficialDailyV516({
      socketPath:socket,databaseDirectory:"/tmp/jf516-official-absent"
    }),e=>e?.code==="OFFICIAL_SIGNATURES_MISSING");
   });
});
test("V5.16: RELOAD também exige assinatura oficial ANTES de enviar comando",async()=>{
 await mockDaemon({"zRELOAD":"RELOADING"},async(socket,seen)=>{
  await assert.rejects(reloadClamdAndVerifyV516({
    socketPath:socket,databaseDirectory:"/tmp/jf516-official-absent"
  }),e=>e?.code==="OFFICIAL_SIGNATURES_MISSING");
  assert.equal(seen.length,0);
 });
});
