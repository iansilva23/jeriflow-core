import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm,chmod} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {scannerConfig,checkedSecret,assertScannerPrivileges,operateOnce} from "../scripts/ouvidoria-scanner-service.mjs";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {encryptAttachment} from "../apps/api/src/ouvidoria-attachments.ts";

const config={JERIFLOW_SCANNER_ENABLE:"1",JERIFLOW_SCANNER_DBUSER:"jf_scanner_runtime",
  JERIFLOW_SCANNER_DBNAME:"jeriflow_test",JERIFLOW_SCANNER_DBHOST:"127.0.0.1",
  JERIFLOW_SCANNER_DB_PASSWORD_FILE:"/var/run/secrets/scanner-password",
  JERIFLOW_CLAMD_SOCKET:"/run/clamav/clamd.sock",
  JERIFLOW_CLAMAV_DB:"/var/lib/clamav"};
test("scanner operacional exige usuario restrito, segredo e socket local",async()=>{
  assert.equal(scannerConfig(config).user,"jf_scanner_runtime");
  for(const wrong of [{...config,JERIFLOW_SCANNER_ENABLE:"0"},
    {...config,JERIFLOW_SCANNER_DBUSER:"jeriflow_owner"},
    {...config,JERIFLOW_SCANNER_DBUSER:"jeriflow_app"},
    {...config,JERIFLOW_CLAMD_SOCKET:"127.0.0.1:3310"},
    {...config,JERIFLOW_CLAMAV_DB:"../../tmp"}]){
    assert.throws(()=>scannerConfig(wrong));
  }
  const dir=await mkdtemp(join(tmpdir(),"jeri-scan-secret-"));
  const file=join(dir,"pwd");
  try{
    await writeFile(file,"secret-test\n",{mode:0o600});
    assert.equal(checkedSecret(file),"secret-test");
    await chmod(file,0o644);
    assert.throws(()=>checkedSecret(file),/SCANNER_SECRET_PERMISSIONS/);
  }finally{await rm(dir,{recursive:true,force:true})}
});
test("scanner operacional recusa credenciais com acesso direto a tabelas",async()=>{
  const safe={attachment_read:false,attachment_update:false,audit_insert:false,
    can_claim:true,can_finish:true};
  assert.equal(await assertScannerPrivileges({query:async()=>({rows:[safe]})}),true);
  for(const variant of [{...safe,attachment_read:true},{...safe,can_finish:false},
    {...safe,audit_insert:true}]){
    await assert.rejects(assertScannerPrivileges({query:async()=>({rows:[variant]})}),
      /SCANNER_PRIVILEGES_UNSAFE/);
  }
});
test("scanner nao retira anexo da fila quando assinaturas nao existem",async()=>{
  const key=randomBytes(32),dir=await mkdtemp(join(tmpdir(),"jeri-clamav-"));
  let queryCount=0;
  const db={query:async()=>{queryCount++;return {rows:[]}}};
  try{
    await assert.rejects(operateOnce(db,key,{socket:"/tmp/clamd.sock",signatures:dir}),
      /MISSING_SIGNATURE_DAILY/);
    assert.equal(queryCount,0);
  }finally{await rm(dir,{recursive:true,force:true});key.fill(0)}
});
