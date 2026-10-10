/**
 * Self-contained CI/operations check. No downloads, no secrets, no customer data.
 * Use FreshClam to populate CLAMAV_DATABASE_DIR before running this check.
 */
import { checkOfficialClamAVDatabasesV516 } from "../apps/api/src/clamav-official-readiness-v516.ts";

const dir=process.env.CLAMAV_DATABASE_DIR;
if(!dir || !dir.startsWith("/")){
  console.error("OFFICIAL_SIGNATURES_UNAVAILABLE: CLAMAV_DATABASE_DIR precisa ser absoluto.");
  process.exitCode=1;
}else{
  try{
    const result=await checkOfficialClamAVDatabasesV516(dir);
    console.log(JSON.stringify({
      check:"v516-clamav-official-signatures",
      ready:result.ready,
      databases:result.databases.map(db=>({
        kind:db.kind,verified:db.verified,buildTimestamp:db.buildTimestamp
      })),
      dailyWithin72Hours:result.dailyWithin72Hours,
      evidenceApproved:result.evidenceApproved,
      protocolCreated:result.protocolCreated
    },null,2));
  }catch(error){
    // Error code only: no file paths, credentials or database metadata.
    console.error("V516_OFFICIAL_CLAMAV_REJECTED: "+(error?.code||"UNEXPECTED_CHECK_FAILURE"));
    process.exitCode=1;
  }
}
