import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OfficialTrafficPhotoWorkerV516} from "../apps/api/src/traffic-photo-official-worker-v516.ts";

test("V5.16: worker operacional nunca abre sem assinaturas oficiais",async()=>{
  const root=await mkdtemp(join(tmpdir(),"jf516-official-worker-"));
  try{
    await assert.rejects(OfficialTrafficPhotoWorkerV516.openPrivate({
      photoRoot:root,
      clamdSocketPath:"/no-private-clamd.sock",
      workerDatabaseUrl:"postgresql://not-real:password@127.0.0.1:5432/none",
      officialDatabaseDirectory:join(root,"no-official-signatures"),
    }),e=>e?.code==="OFFICIAL_SIGNATURES_MISSING");
  }finally{await rm(root,{recursive:true,force:true});}
});
