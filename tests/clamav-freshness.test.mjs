import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,writeFile,rm,symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {parseOfficialDaily,checkOfficialSignatures} from "../scripts/clamav-freshness.mjs";

test("FreshClam: rejeita base desatualizada, ausente, ambigua ou futura",()=>{
  const now=Date.parse("2026-10-09T12:00:00Z");
  const info=(date,version="28148")=>"Version: "+version+"\nBuild time: "+date+"\n";
  const valid=info("Thu Oct 08 12:00:00 2026");
  const x=parseOfficialDaily(valid,now);
  assert(x.ageHours>=23&&x.ageHours<=25);assert.equal(x.version,"28148");
  assert.throws(()=>parseOfficialDaily(info("Mon Oct 05 00:00:00 2026"),now),/SIGNATURES_EXPIRED/);
  assert.throws(()=>parseOfficialDaily(info("Mon Oct 12 00:00:00 2026"),now),/SIGNATURES_EXPIRED/);
  assert.throws(()=>parseOfficialDaily(valid+valid,now),/SIGNATURE_INFO_INVALID/);
  assert.throws(()=>parseOfficialDaily("Version: 28148",now),/SIGNATURE_INFO_INVALID/);
});
test("FreshClam: exige daily, main e bytecode regulares antes de considerar scanner apto",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"jeriflow-av-"));
  const now=Date.parse("2026-10-09T12:00:00Z");
  const body=Buffer.alloc(2048,66);
  const execute=async (_command,args)=>{
    assert.equal(args[0],"--info");assert.match(args[1],/daily\.(cvd|cld)$/);
    return {stdout:"Version: 28148\nBuild time: Thu Oct 08 12:00:00 2026\n"};
  };
  try {
    await writeFile(join(dir,"daily.cvd"),body);
    await assert.rejects(checkOfficialSignatures(dir,{now,execute}),/MISSING_SIGNATURE_MAIN/);
    await writeFile(join(dir,"main.cvd"),body);
    await writeFile(join(dir,"bytecode.cvd"),body);
    const good=await checkOfficialSignatures(dir,{now,execute});
    assert.equal(good.version,"28148");
    await rm(join(dir,"bytecode.cvd"));
    await symlink(join(dir,"main.cvd"),join(dir,"bytecode.cvd"));
    await assert.rejects(checkOfficialSignatures(dir,{now,execute}),/INVALID_SIGNATURE_FILE/);
  }finally{await rm(dir,{recursive:true,force:true})}
});
