import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {bearerTransport,cookieTransport} from "../packages/auth/client.ts";
import {
 guardSupportActionsV516,GUARD_SUPPORT_REASONS_V516
} from "../apps/guarda/guard-support-actions-v516.ts";
const mid="733c6075-bd63-48f8-b2a9-f21250e238df";
const id="94521636-4b86-46d1-8c5e-3644b1e15b51";
const protocol="JF-20261015-000001";

test("apoio: quatro motivos preservados e URL permitida só com sessão",async()=>{
 const calls=[];
 const fetchOld=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
  calls.push({url,opts});
  const body=JSON.parse(opts.body);
  return {ok:true,status:200,json:async()=>({
   requestId:body.requestId,protocolId:protocol,recorded:true,alreadyProcessed:false
  })};
 };
 try{
  const vault={get:async()=>"A".repeat(43),set:async()=>{},remove:async()=>{}};
  const transport=bearerTransport(()=>"https://example.invalid",vault);
  const actions=guardSupportActionsV516(transport,mid,()=>id);
  assert.deepEqual(GUARD_SUPPORT_REASONS_V516,[
   "Necessidade de outro agente","Via bloqueada","Conflito no local","Outro"
  ]);
  await actions.submit(protocol,"Necessidade de outro agente","  Pedido fictício  ");
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://example.invalid/api/v1/guarda/transito/"+protocol+"/apoio");
  assert.equal(calls[0].opts.method,"POST");
  assert.equal(calls[0].opts.redirect,"error");
  assert.equal(calls[0].opts.headers.Authorization,"Bearer "+"A".repeat(43));
  assert.equal(calls[0].opts.headers["X-JeriFlow-Municipality-Id"],mid);
  assert.deepEqual(JSON.parse(calls[0].opts.body),{
   requestId:id,reason:"Necessidade de outro agente",note:"Pedido fictício"
  });
 }finally{globalThis.fetch=fetchOld;}
});
test("ACK perdido: conserva o UUID e bloqueia alteração do corpo até confirmação",async()=>{
 let called=0;const seen=[];
 const fake={supportRequest:async(mid,pid,body)=>{
  called++;seen.push({...body});
  if(called===1)throw Error("NETWORK");
  return {requestId:body.requestId,protocolId:pid,recorded:true,alreadyProcessed:true};
 }};
 const actions=guardSupportActionsV516(fake,mid,()=>id);
 await assert.rejects(actions.submit(protocol,"Outro","Sem despacho"),/NETWORK/);
 await assert.rejects(actions.submit(protocol,"Via bloqueada","Sem despacho"),/GUARD_SUPPORT_RETRY_PAYLOAD_CHANGED/);
 await actions.submit(protocol,"Outro","  Sem despacho  ");
 assert.equal(called,2);
 assert.deepEqual(seen[0],seen[1]);
 assert.equal(seen[0].requestId,id);
});
test("rejeita dados inválidos sem tocar rede",async()=>{
 let n=0;
 const fake={supportRequest:async()=>{n++;return {};}};
 const actions=guardSupportActionsV516(fake,mid,()=>id);
 await assert.rejects(actions.submit("../auth","Outro","nota"),/GUARD_SUPPORT_INVALID_INPUT/);
 await assert.rejects(actions.submit(protocol,"Motivo inventado","nota"),/GUARD_SUPPORT_INVALID_INPUT/);
 await assert.rejects(actions.submit(protocol,"Outro","a".repeat(2001)),/GUARD_SUPPORT_INVALID_INPUT/);
 await assert.rejects(actions.submit(protocol,"Outro","\u0000"),/GUARD_SUPPORT_INVALID_INPUT/);
 assert.equal(n,0);
 const noToken=bearerTransport(()=>"https://example.invalid",{
  get:async()=>null,set:async()=>{},remove:async()=>{}
 });
 await assert.rejects(noToken.supportRequest(mid,protocol,{
  requestId:id,reason:"Outro",note:"sem sessão"
 }),e=>e.status===401);
 assert.equal(cookieTransport().supportRequest,undefined);
});
test("somente guarda autorizada na prévia vê pedido de apoio para ocorrências abertas",()=>{
 const app=readFileSync(new URL("../apps/guarda/App.tsx",import.meta.url),"utf8");
 const view=readFileSync(new URL("../apps/guarda/GuardAuthorizedViewV516.tsx",import.meta.url),"utf8");
 const queue=readFileSync(new URL("../apps/guarda/GuardQueueScreenV516.tsx",import.meta.url),"utf8");
 const panel=readFileSync(new URL("../apps/guarda/GuardSupportPanelV516.tsx",import.meta.url),"utf8");
 assert.match(app,/EXPO_PUBLIC_GUARDA_V516_PREVIEW === "1"/);
 assert.match(view,/guardAuthorizedActionsV516\(/);
 assert.match(view,/if\(authorized&&grant\)return <GuardQueueScreenV516/);
 assert.match(view,/guardSupportActionsV516\(transport,grant.mid,newRequestId\)/);
 assert.match(queue,/selected.status==="RECEBIDA"\|\|selected.status==="EM ATENDIMENTO"/);
 assert.match(queue,/<GuardSupportPanelV516/);
 assert.match(queue,/selected.status==="FINALIZADA"&&<Text/);
 for(const reason of ["Necessidade de outro agente","Via bloqueada","Conflito no local","Outro"]){
  assert(GUARD_SUPPORT_REASONS_V516.includes(reason));
 }
 assert.match(panel,/Não foi possível confirmar o registro/);
 assert.match(panel,/Pedido registrado para consulta/);
 assert.doesNotMatch(panel,/dispatch|sendNotification|entregue à viatura/i);
});
