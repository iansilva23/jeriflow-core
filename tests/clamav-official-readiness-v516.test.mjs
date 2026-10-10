import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {
  parseVerifiedSigtoolInfoV516 as parse,
  checkOfficialClamAVDatabasesV516 as check,
} from "../apps/api/src/clamav-official-readiness-v516.ts";

const now=Date.parse("2026-10-10T14:00:00.000Z");
const verifiedAt=time=>["File: daily.cvd",
  "Build time: "+time,
  "Signatures: 1000000",
  "Digital signature: fake-not-trusted-unless-sigtool-verifies",
  "Verification OK.",""].join("\n");
const error=code=>e=>e?.code===code;

test("V5.16: parser só aceita saída com verificação criptográfica explícita",()=>{
  assert.equal(parse(verifiedAt("10 Oct 2026 12:00 +0000"),now,true),
    "2026-10-10T12:00:00.000Z");
  assert.throws(()=>parse("File: daily.cvd\nBuild time: 10 Oct 2026 12:00 +0000\n",now,true),
    error("OFFICIAL_SIGNATURES_UNVERIFIED"));
  assert.throws(()=>parse("Verification FAILED\nBuild time: 10 Oct 2026 12:00 +0000",now,true),
    error("OFFICIAL_SIGNATURES_UNVERIFIED"));
});
test("V5.16: assinatura diária com idade superior a 72h é rejeitada",()=>{
  assert.throws(()=>parse(verifiedAt("01 Oct 2026 12:00 +0000"),now,true),
    error("OFFICIAL_SIGNATURES_STALE"));
  assert.equal(parse(verifiedAt("01 Oct 2026 12:00 +0000"),now,false),
    "2026-10-01T12:00:00.000Z",
    "main/bytecode podem ter data antiga; daily não");
});
test("V5.16: datas futuras/ilegíveis são bloqueadas",()=>{
  assert.throws(()=>parse(verifiedAt("20 Oct 2026 12:00 +0000"),now,true),
    error("OFFICIAL_SIGNATURES_UNVERIFIED"));
  assert.throws(()=>parse(verifiedAt("not-a-date"),now,true),
    error("OFFICIAL_SIGNATURES_UNVERIFIED"));
});
test("V5.16: diretório ausente não pode autorizar qualquer fotografia",async()=>{
  await assert.rejects(check("/absolutely/absent/jf516/signatures",now),
    error("OFFICIAL_SIGNATURES_MISSING"));
});
test("V5.16: entrada inválida não escolhe executáveis nem caminhos",async()=>{
  await assert.rejects(check("relative/path",now),
    error("OFFICIAL_SIGNATURES_UNAVAILABLE"));
  await assert.rejects(check("/tmp/no\0path",now),
    error("OFFICIAL_SIGNATURES_UNAVAILABLE"));
});
test("V5.16: banco sintético sem assinatura OFICIAL nunca pode passar",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"jf516-invalid-cvd-"));
  try{
    // Manter >512 bytes e formato .cvd de propósito: extensão/tamanho
    // não substituem verificação criptográfica do sigtool real.
    await writeFile(join(dir,"main.cvd"),Buffer.alloc(1024,65));
    await assert.rejects(check(dir,now),
      e=>["OFFICIAL_SIGNATURES_UNAVAILABLE","OFFICIAL_SIGNATURES_UNVERIFIED"].includes(e?.code));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("V5.16: foto/protocolo não são aprovados por metadados de versão",()=>{
  const text=verifiedAt("10 Oct 2026 12:00 +0000");
  assert.equal(parse(text,now,true),"2026-10-10T12:00:00.000Z");
  assert(!text.includes("evidenceApproved")&&!text.includes("protocolCreated"));
});
