import { execFile as callbackExecFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
const execFile=promisify(callbackExecFile);

export function parseOfficialDaily(value,now=Date.now(),maxAgeHours=72) {
  if(typeof value!=="string")throw Error("SIGNATURE_INFO_MISSING");
  const builds=[...value.matchAll(/^Build time:\s*(.+)$/gmi)];
  const versions=[...value.matchAll(/^Version:\s*(\d+)\s*$/gmi)];
  if(builds.length!==1||versions.length!==1)throw Error("SIGNATURE_INFO_INVALID");
  const timestamp=Date.parse(builds[0][1]);
  if(!Number.isFinite(timestamp))throw Error("SIGNATURE_DATE_INVALID");
  const ageHours=(now-timestamp)/3600000;
  if(ageHours < -1 || ageHours > maxAgeHours)throw Error("SIGNATURES_EXPIRED");
  return {ageHours,version:versions[0][1]};
}

export async function checkOfficialSignatures(dbDir,{
  now=Date.now(),maxAgeHours=72,execute=execFile
}={}) {
  if(typeof dbDir!=="string"||!dbDir.startsWith("/")||dbDir.includes(".."))
    throw Error("INVALID_SIGNATURE_DIRECTORY");
  const files={};
  for(const base of ["daily","main","bytecode"]){
    let path;
    for(const ext of ["cvd","cld"]){
      const candidate=join(dbDir,base+"."+ext);
      try{
        const st=await lstat(candidate);
        if(!st.isFile()||st.isSymbolicLink()||st.size<1024)throw Error("INVALID_SIGNATURE_FILE");
        path=candidate;break;
      }catch(e){if(e.code!=="ENOENT")throw e;}
    }
    if(!path)throw Error("MISSING_SIGNATURE_"+base.toUpperCase());
    files[base]=path;
  }
  const result=await execute("sigtool",["--info",files.daily],
    {timeout:5000,maxBuffer:16384,env:{...process.env,LC_ALL:"C"}});
  return parseOfficialDaily(result.stdout,now,maxAgeHours);
}
