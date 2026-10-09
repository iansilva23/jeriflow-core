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
  owner,identityKey,socketPath,scanner=clamdScan,onFailure,scannerVersion="clamd-local-v1"
}) {
  const lease=randomUUID();
  const claim=await owner.query(`WITH target AS(
    SELECT id FROM app.ouvidoria_attachments
    WHERE scan_attempts<3 AND (
      scan_status='quarantined' OR
      (scan_status='scanning' AND scan_started_at<clock_timestamp()-interval '3 minutes'))
    ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE app.ouvidoria_attachments a
  SET scan_status='scanning',scan_started_at=clock_timestamp(),scan_lease=$1,
    scan_attempts=scan_attempts+1
  FROM target WHERE a.id=target.id
  RETURNING a.id,a.municipality_id,a.protocol_id,a.client_request_id,
    a.size_bytes,a.sha256,a.encrypted_bytes`,[lease]);
  if(!claim.rowCount)return {processed:false};
  const a=claim.rows[0];
  let state="quarantined",event="retry";
  try {
    const bytes=decryptAttachment(identityKey,a.municipality_id,a.protocol_id,a.client_request_id,
      Buffer.from(a.encrypted_bytes));
    try{
      if(bytes.length!==a.size_bytes||createHash("sha256").update(bytes).digest("hex")!==a.sha256)
        throw new Error("ATTACHMENT_INTEGRITY_MISMATCH");
      const verdict=await scanner(socketPath,bytes);
      if(verdict!=="clean"&&verdict!=="rejected")throw new Error("SCANNER_INVALID_VERDICT");
      state=verdict;event=verdict;
    } finally {bytes.fill(0)}
  } catch (e) { /* Indeterminado permanece em quarentena; nunca libera bytes. */
    if(typeof onFailure==="function")onFailure(e);
  }
  const done=await owner.query(`WITH updated AS(
    UPDATE app.ouvidoria_attachments
    SET scan_status=$3,scan_started_at=NULL,scan_lease=NULL
    WHERE id=$1 AND scan_status='scanning' AND scan_lease=$2
    RETURNING id
  ), event AS(
    INSERT INTO app.ouvidoria_attachment_scan_events(attachment_id,result,scanner_version)
    SELECT id,$4,$5 FROM updated RETURNING id
  ) SELECT (SELECT count(*) FROM updated) AS count,
      (SELECT count(*) FROM event) AS events`,
    [a.id,lease,state,event,safeScanVersion(scannerVersion)]);
  if(Number(done.rows[0]?.count)!==1||Number(done.rows[0]?.events)!==1)
    throw new Error("SCAN_LEASE_EXPIRED");
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
