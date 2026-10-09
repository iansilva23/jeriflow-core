// Teste isolado de atualizacao oficial FreshClam. Nada e disponibilizado para download no JeriFlow.
import { mkdtemp,mkdir,writeFile,readdir,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { clamdScan } from "../../apps/api/src/clamd-scan.mjs";

const report={scope:"clamav-freshclam-official-daily",verified:false,
 officialDailyFresh:false,productionApproved:false,vpsValidated:false,
 startedAt:new Date().toISOString()};
const dir=await mkdtemp(join(tmpdir(),"jeriflow-freshclam-"));
const db=join(dir,"db"),config=join(dir,"freshclam.conf");
const artifact=join(process.cwd(),"artifacts/clamav-official");
let daemon;
async function run(bin,args,timeoutMs){
  let output="";
  const p=spawn(bin,args,{stdio:["ignore","pipe","pipe"],env:{...process.env,LC_ALL:"C"}});
  const read=x=>{output=(output+x.toString()).slice(-1600)};
  p.stdout.on("data",read);p.stderr.on("data",read);
  const timer=setTimeout(()=>p.kill("SIGTERM"),timeoutMs);
  const exit=await new Promise((resolve,reject)=>{
    p.once("error",reject);p.once("exit",(code,signal)=>resolve({code,signal}));
  }).finally(()=>clearTimeout(timer));
  return {exit,output};
}
try{
  if(process.env.NODE_ENV==="production")throw Error("LOCAL_ONLY");
  await mkdir(db,{recursive:true});
  await writeFile(config,[
    "DatabaseDirectory "+db,"DatabaseMirror database.clamav.net",
    "ScriptedUpdates no","MaxAttempts 1","Checks 1",
    "TestDatabases yes","LogTime yes"
  ].join("\n")+"\n",{mode:0o600});
  const fresh=await run("freshclam",["--config-file="+config,"--stdout"],660000);
  if(fresh.exit.code!==0){
    report.diagnosticCode="FRESHCLAM_OFFICIAL_UPDATE_UNAVAILABLE";
    throw Error("FRESHCLAM_UPDATE_FAILED");
  }
  const names=await readdir(db);
  const daily=names.find(x=>x==="daily.cvd"||x==="daily.cld");
  if(!daily)throw Error("OFFICIAL_DAILY_MISSING");
  if(!names.some(x=>x==="main.cvd"||x==="main.cld"))throw Error("OFFICIAL_MAIN_MISSING");
  if(!names.some(x=>x==="bytecode.cvd"||x==="bytecode.cld"))throw Error("OFFICIAL_BYTECODE_MISSING");

  const info=await run("sigtool",["--info",join(db,daily)],30000);
  if(info.exit.code!==0)throw Error("SIGTOOL_VALIDATION_FAILED");
  const build=info.output.match(/^Build time:\s*(.+)$/mi);
  const version=info.output.match(/^Version:\s*(\d+)\s*$/mi);
  if(!build||!version)throw Error("OFFICIAL_DATABASE_METADATA_MISSING");
  const date=Date.parse(build[1]);
  if(!Number.isFinite(date))throw Error("BUILD_DATE_PARSE_FAILED");
  const ageHours=(Date.now()-date)/3600000;
  report.signatureVersion=version[1];
  report.signatureAgeHours=Math.round(ageHours*10)/10;
  if(ageHours< -1||ageHours>72)throw Error("OFFICIAL_DATABASE_TOO_OLD");
  report.officialDailyFresh=true;
  const socket=join(dir,"clamd.sock");
  const daemonConfig=join(dir,"clamd.conf");
  await writeFile(daemonConfig,[
    "Foreground yes","LogTime yes","DatabaseDirectory "+db,
    "LocalSocket "+socket,"LocalSocketMode 600","FixStaleSocket yes",
    "MaxThreads 2","MaxConnectionQueueLength 4",
    "StreamMaxLength 2M","MaxFileSize 2M","MaxScanSize 4M",
    "CommandReadTimeout 10","ReadTimeout 10","SelfCheck 0"
  ].join("\n")+"\n",{mode:0o600});
  daemon=spawn("clamd",["--config-file="+daemonConfig],{stdio:"ignore"});
  const clean=Buffer.concat([Buffer.from("%PDF-1.7\\n"),Buffer.alloc(100,65)]);
  let started=false;
  for(let i=0;i<120;i++){
    if(daemon.exitCode!==null)throw Error("CLAMD_OFFICIAL_START_FAILED");
    try {if(await clamdScan(socket,clean,{timeoutMs:2500})==="clean"){started=true;break}}catch{}
    await delay(300);
  }
  if(!started)throw Error("CLAMD_OFFICIAL_NOT_READY");
  const testBytes=Buffer.from([
    "X5O!P%","@AP[4\\","PZX54(P^)7CC)7}$EICAR-",
    "STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
  ].join(""),"ascii");
  if(testBytes.length!==68)throw Error("EICAR_FIXTURE_INVALID");
  if((await clamdScan(socket,testBytes))!=="rejected")
    throw Error("OFFICIAL_EICAR_DETECTION_MISSING");
  report.officialBasesLoaded=true;
  report.clamdOfficialScanPassed=true;
  report.verified=true;
}catch(e){
  report.failureCode=String(e.message??e).slice(0,120);
  process.exitCode=1;
}finally{
  report.finishedAt=new Date().toISOString();
  await mkdir(artifact,{recursive:true});
  await writeFile(join(artifact,"report.json"),JSON.stringify(report,null,2)+"\n");
  if(daemon&&daemon.exitCode===null){
    daemon.kill("SIGTERM");
    for(let i=0;i<20&&daemon.exitCode===null;i++)await delay(100);
    if(daemon.exitCode===null)daemon.kill("SIGKILL");
  }
  await rm(dir,{recursive:true,force:true}).catch(()=>{});
  console.log(JSON.stringify(report));
}
