import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes,randomUUID } from "node:crypto";
import { clamdScan } from "../apps/api/src/clamd-scan.mjs";
import { scanOnce } from "../scripts/ouvidoria-scan-once.mjs";
import { encryptAttachment } from "../apps/api/src/ouvidoria-attachments.ts";
import { createHash } from "node:crypto";

async function fakeClamd(verdict,action){
  const dir=await mkdtemp(join(tmpdir(),"jeriflow-clamd-"));
  const path=join(dir,"clamd.sock");
  const server=createServer(socket=>{
    let data=Buffer.alloc(0),header=false,received=Buffer.alloc(0);
    socket.on("data",chunk=>{
      data=Buffer.concat([data,chunk]);
      if(!header){
        if(data.length<6)return;
        if(data.subarray(0,6).equals(Buffer.from("zPING\0"))){
          socket.end(Buffer.from("PONG\0"));return;
        }
        if(data.length<10)return;
        assert(data.subarray(0,10).equals(Buffer.from("zINSTREAM\0")));
        data=data.subarray(10);header=true;
      }
      while(data.length>=4){
        const length=data.readUInt32BE(0);
        if(data.length<length+4)return;
        if(length===0){
          action?.(received);
          const reply=verdict==="clean"?"stream: OK":
            verdict==="infected"?"stream: Eicar-Test-Signature FOUND":"stream: ERROR";
          socket.end(Buffer.from(reply+"\0"));return;
        }
        received=Buffer.concat([received,data.subarray(4,length+4)]);
        data=data.subarray(length+4);
      }
    });
  });
  await new Promise(r=>server.listen(path,r));
  return {path,close:async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}};
}
test("ClamAV INSTREAM aceita clean/rejected e recusa respostas inconclusivas",async()=>{
 const bytes=Buffer.concat([Buffer.from("%PDF-1.7\n"),randomBytes(90)]);
 for(const verdict of ["clean","infected","error"]){
   const clamd=await fakeClamd(verdict,b=>assert.deepEqual(b,bytes));
   try {
     if(verdict==="error")await assert.rejects(clamdScan(clamd.path,bytes));
     else assert.equal(await clamdScan(clamd.path,bytes),verdict==="clean"?"clean":"rejected");
   }finally{await clamd.close()}
 }
 await assert.rejects(clamdScan("/tmp/../x",bytes));
 await assert.rejects(clamdScan("/tmp/missing-jeriflow-clamd.sock",bytes,{timeoutMs:100}));
});
test("worker vincula o resultado à lease; falha de scanner mantém quarentena",async()=>{
 const key=randomBytes(32),municipality_id=randomUUID(),protocol_id=randomUUID(),
 client_request_id=randomUUID(),id=randomUUID();
 const bytes=Buffer.concat([Buffer.from("%PDF-1.7\n"),Buffer.alloc(75,65)]);
 const encrypted_bytes=encryptAttachment(key,municipality_id,protocol_id,client_request_id,bytes);
 const values={id,municipality_id,protocol_id,client_request_id,
   size_bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),encrypted_bytes};
 for(const result of ["clean","rejected","failure"]){
  const calls=[];
  const owner={async query(sql,params){
    calls.push({sql,params});
    if(calls.length===1)return {rowCount:1,rows:[values]};
    return {rowCount:1,rows:[{settled:true}]};
  }};
  const answer=await scanOnce({owner,identityKey:key,socketPath:"/unused",scanner:async()=> {
    if(result==="failure")throw new Error("SIMULATED_DOWN");
    return result;
  }});
  assert.equal(answer.status,result==="failure"?"quarantined":result);
  assert.equal(calls.length,2);
  assert.match(calls[0].sql,/ouvidoria_scan_claim/);
  assert.match(calls[1].sql,/ouvidoria_scan_finish/);
  assert.equal(calls[1].params[2],answer.status);
  assert.equal(calls[1].params[1],calls[0].params[0]);
 }
});
