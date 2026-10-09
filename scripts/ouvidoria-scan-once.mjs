import { randomUUID,createHash } from "node:crypto";
import { resolve,dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readIdentityKey } from "../apps/api/src/identity-security.ts";
import { decryptAttachment } from "../apps/api/src/ouvidoria-attachments.ts";
import { ownerClient } from "./identity-database.mjs";
import { clamdScan } from "../apps/api/src/clamd-scan.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
function safeScanVersion(value) {
  return /^[A-Za-z0-9._-]{1,80}$/.test(value??"")?value:"clamd-local-v1";
}
// Somente infraestrutura LOCAL isolada. Nunca usar conta de owner em produção.
export async function scanOnce({
  owner,identityKey,socketPath,scanner=clamdScan,scannerVersion="clamd-local-v1"
}) {
  const lease=randomUUID();
  const claim=await owner.query("SELECT * FROM app.ouvidoria_scan_claim($1)",[lease]);
  if(!claim.rowCount)return {processed:false};
  const a=claim.rows[0];
  let state="quarantined";
  try {
    const bytes=decryptAttachment(identityKey,a.municipality_id,a.protocol_id,a.client_request_id,
      Buffer.from(a.encrypted_bytes));
    try{
      if(bytes.length!==a.size_bytes||createHash("sha256").update(bytes).digest("hex")!==a.sha256)
        throw new Error("ATTACHMENT_INTEGRITY_MISMATCH");
      const verdict=await scanner(socketPath,bytes);
      if(verdict!=="clean"&&verdict!=="rejected")throw new Error("SCANNER_INVALID_VERDICT");
      state=verdict;
    } finally {bytes.fill(0)}
  } catch { /* Indeterminado permanece em quarentena; nunca libera bytes. */ }
  const done=await owner.query("SELECT app.ouvidoria_scan_finish($1,$2,$3,$4) AS settled",
    [a.id,lease,state,safeScanVersion(scannerVersion)]);
  if(done.rows[0]?.settled!==true)throw new Error("SCAN_LEASE_EXPIRED");
  return {processed:true,status:state};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==="production"||process.env.JERIFLOW_SCAN_LOCAL_ONLY!=="1"){
    console.error("SCANNER_DISABLED_LOCAL_ONLY");process.exitCode=1;
  } else {
    const owner=ownerClient(root);
    try{
      await owner.connect();
      const result=await scanOnce({owner,identityKey:readIdentityKey(root),
        socketPath:process.env.JERIFLOW_CLAMD_SOCKET??"/run/clamav/clamd.ctl"});
      console.log(JSON.stringify(result));
    }catch(e){console.error("ATTACHMENT_SCAN_UNAVAILABLE");process.exitCode=1}
    finally{await owner.end().catch(()=>{})}
  }
}
