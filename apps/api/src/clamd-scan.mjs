import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

function connect(socketPath, timeoutMs) {
  return new Promise((resolve,reject)=>{
    const socket=createConnection({path:socketPath});
    let done=false;
    socket.setTimeout(timeoutMs);
    const bad=e=>{if(!done){done=true;socket.destroy();reject(e)}};
    socket.once("error",bad);
    socket.once("timeout",()=>bad(new Error("CLAMD_TIMEOUT")));
    socket.once("connect",()=>{if(!done){done=true;socket.off("error",bad);resolve(socket)}});
  });
}
async function command(socketPath,frames,timeoutMs=8000) {
  if(typeof socketPath!=="string"||!socketPath.startsWith("/")||socketPath.includes(".."))
    throw new Error("CLAMD_LOCAL_SOCKET_REQUIRED");
  const socket=await connect(socketPath,timeoutMs);
  return new Promise(async(resolve,reject)=>{
    let ended=false,reply=Buffer.alloc(0);
    const fail=e=>{if(ended)return;ended=true;socket.destroy();reject(e)};
    socket.once("error",fail);
    socket.once("timeout",()=>fail(new Error("CLAMD_TIMEOUT")));
    socket.on("data",chunk=>{
      if(ended)return;
      if(reply.length+chunk.length>2048)return fail(new Error("CLAMD_OVERSIZE_REPLY"));
      reply=Buffer.concat([reply,chunk]);
      const idx=reply.indexOf(0);
      if(idx!==-1){
        if(idx!==reply.length-1)return fail(new Error("CLAMD_EXTRA_REPLY"));
        ended=true;socket.destroy();resolve(reply.subarray(0,idx).toString("utf8"));
      }
    });
    socket.once("end",()=>{if(!ended)fail(new Error("CLAMD_INCOMPLETE_REPLY"))});
    try{
      for(const frame of frames){
        if(ended)break;
        if(!socket.write(frame))await new Promise((ok,bad)=>{
          socket.once("drain",ok);socket.once("error",bad);
        });
      }
    }catch(e){fail(e)}
  });
}
export async function clamdScan(socketPath,bytes,{timeoutMs=8000}={}) {
  if(!Buffer.isBuffer(bytes)||bytes.length<32||bytes.length>1048576)
    throw new Error("SCAN_SIZE_INVALID");
  const ping=await command(socketPath,[Buffer.from("zPING\\0".replace("\\0","\0"),"binary")],timeoutMs);
  if(ping!=="PONG")throw new Error("CLAMD_PING_INVALID");
  const frames=[Buffer.from("zINSTREAM\0","binary")];
  for(let pos=0;pos<bytes.length;pos+=65536){
    const slice=bytes.subarray(pos,Math.min(bytes.length,pos+65536));
    const len=Buffer.alloc(4);len.writeUInt32BE(slice.length);
    frames.push(len,slice);
  }
  frames.push(Buffer.alloc(4));
  const response=await command(socketPath,frames,timeoutMs);
  if(response==="stream: OK")return "clean";
  if(/^stream: [a-zA-Z0-9_.:() -]{1,130} FOUND$/.test(response))return "rejected";
  throw new Error("CLAMD_INCONCLUSIVE");
}
