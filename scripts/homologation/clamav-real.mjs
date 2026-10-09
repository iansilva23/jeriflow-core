// Homologacao isolada do EXECUTAVEL ClamAV real (nao do mock).
// Assinatura local EICAR de laboratorio: isto NAO comprova base oficial atualizada.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { clamdScan } from "../../apps/api/src/clamd-scan.mjs";

const report={scope:"clamav-real-local-signature",date:new Date().toISOString(),
  engine:"ClamAV clamd (processo real)",signatureSource:"local synthetic EICAR .ndb",
  officialSignaturesFresh:false,productionApproved:false,vpsValidated:false,
  testResults:[]};
const mark=(name,pass)=>{report.testResults.push({name,pass});if(!pass)throw Error("CONTROL_FAILED_"+name)};
const dir=await mkdtemp(join(tmpdir(),"jeri-clamd-"));
const socket=join(dir,"clamd.sock"),db=join(dir,"db");
const config=join(dir,"clamd.conf");
let child, log="",pass=false;
const artifacts=join(process.cwd(),"artifacts/clamav-real");
try{
  if(process.env.NODE_ENV==="production")throw new Error("LOCAL_ONLY");
  await mkdir(db,{recursive:true});
  // EICAR e arquivo de teste nao executavel. Dividido para evitar alarmes acidentais
  // de ferramentas que procuram a string completa em codigo-fonte.
  const eicar=Buffer.from([
    "X5O!P%","@AP[4\\","PZX54(P^)7CC)7}$EICAR-",
    "STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
  ].join(""),"ascii");
  if(eicar.length!==68)throw Error("EICAR_FIXTURE_INVALID");
  const harmless=Buffer.concat([Buffer.from("%PDF-1.7\\n","ascii"),Buffer.alloc(96,65)]);
  const infected=Buffer.concat([Buffer.from("%PDF-1.7\\n","ascii"),eicar,Buffer.alloc(40,66)]);
  await writeFile(join(db,"jeriflow-eicar.ndb"),
    "JeriFlow.Eicar.Lab:0:*:"+eicar.toString("hex")+"\n",{mode:0o600});
  const lines=[
    "Foreground yes","LogTime yes","DatabaseDirectory "+db,
    "LocalSocket "+socket,"LocalSocketMode 600","FixStaleSocket yes",
    "MaxThreads 2","MaxConnectionQueueLength 4",
    "StreamMaxLength 2M","MaxFileSize 2M","MaxScanSize 4M",
    "CommandReadTimeout 10","ReadTimeout 10","SelfCheck 0"
  ];
  await writeFile(config,lines.join("\n")+"\n",{mode:0o600});
  child=spawn("clamd",["--config-file="+config],{stdio:["ignore","pipe","pipe"]});
  const onLog=chunk=>{log=(log+chunk.toString()).slice(-1600)};
  child.stdout.on("data",onLog);child.stderr.on("data",onLog);
  let ready=false;
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw Error("CLAMD_EXITED_BEFORE_READY");
    try {if((await clamdScan(socket,harmless,{timeoutMs:2000}))==="clean"){ready=true;break}}catch{}
    await delay(300);
  }
  mark("daemon_unix_socket_real",ready);
  mark("limpo_aprovado",await clamdScan(socket,harmless)==="clean");
  mark("eicar_detectado",await clamdScan(socket,eicar)==="rejected");
  mark("arquivo_contaminado_rejeitado",await clamdScan(socket,infected)==="rejected");
  let missingDenied=false;
  try{await clamdScan(join(dir,"unavailable.sock"),harmless,{timeoutMs:1000})}
  catch{missingDenied=true}
  mark("antivirus_indisponivel_falha_fechado",missingDenied);
  pass=true;
}catch(error){
  report.failure=String(error?.message??error).slice(0,140);
  report.clamdLogTail=log.slice(-400);
  process.exitCode=1;
}finally{
  report.complete=pass;report.finishedAt=new Date().toISOString();
  await mkdir(artifacts,{recursive:true});
  await writeFile(join(artifacts,"report.json"),JSON.stringify(report,null,2)+"\n");
  if(child&&child.exitCode===null){
    child.kill("SIGTERM");
    for(let i=0;i<12&&child.exitCode===null;i++)await delay(100);
    if(child.exitCode===null)child.kill("SIGKILL");
  }
  await rm(dir,{recursive:true,force:true}).catch(()=>{});
  console.log(JSON.stringify({complete:report.complete,checks:report.testResults,
    officialSignaturesFresh:false,productionApproved:false,
    ...(report.failure?{failure:report.failure}:{})}));
}
