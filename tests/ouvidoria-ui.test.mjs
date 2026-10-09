import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { bearerTransport } from "../packages/auth/client.ts";
import { gateway, sessionCookie } from "../apps/admin/lib/gateway.ts";
import { protocolMutationResult, readProtocolPage, readProtocolHistory, protocolStatusLabels } from "../packages/contracts/src/ouvidoria.ts";

const token=randomBytes(32).toString("base64url");
const municipalityId=randomUUID(),protocolId=randomUUID();
const item={id:protocolId,municipalityId,category:"denuncia",title:"Luzes apagadas",description:"Teste de protocolo",
  status:"open",response:null,contestNote:null,contestCount:0,revision:1,
  createdAt:"2026-10-08T12:00:00Z",updatedAt:"2026-10-08T12:00:00Z"};

test("contrato da lista e revisões da Ouvidoria recusam resposta adulterada",()=>{
  assert.equal(readProtocolPage({items:[item],next:null}).items[0].id,protocolId);
  assert.equal(protocolStatusLabels.contested,"Contestado");
  for(const bad of [{items:"erro",next:null},{items:[{...item,revision:-1}],next:null},
    {items:[{...item,status:"admin"}],next:null},{items:[item],next:123},
    {items:[{...item,description:123}],next:null}]) assert.throws(()=>readProtocolPage(bad));
  assert.deepEqual(protocolMutationResult({protocolId,status:"responded",revision:2}),
    {protocolId,status:"responded",revision:2});
  assert.throws(()=>protocolMutationResult({protocolId,status:"injetado",revision:1}));
});

test("BFF Ouvidoria usa cookie HttpOnly e nega origem externa antes da API",async t=>{
  const upstream=[];
  const server=createServer(async(req,res)=>{
    upstream.push({method:req.method,url:req.url,authorization:req.headers.authorization,origin:req.headers.origin});
    const body=[];for await(const part of req)body.push(part);
    assert.deepEqual(JSON.parse(Buffer.concat(body).toString()),{municipalityId,scope:"fila"});
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify({items:[item],next:null}));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const config={origin:"https://admin.example.invalid",api:"http://127.0.0.1:"+server.address().port};
  const cookie=`${sessionCookie}=${token}`;
  const req=(origin,extra={})=>new Request(config.origin+"/api/identity/ouvidoria/query",{
    method:"POST",headers:{"Host":"admin.example.invalid","Origin":origin,"Content-Type":"application/json",
      "X-JeriFlow-Request":"1","Cookie":cookie,...extra},body:JSON.stringify({municipalityId,scope:"fila"})
  });
  const ok=await gateway(req(config.origin),"/ouvidoria/query",config);
  assert.equal(ok.status,200);
  const data=await ok.json();assert.equal(data.items[0].title,"Luzes apagadas");
  assert(!JSON.stringify(data).includes(token));
  assert.equal(upstream.length,1);
  assert.equal(upstream[0].authorization,"Bearer "+token);
  assert.equal(upstream[0].origin,undefined);
  assert.equal((await gateway(req("https://evil.invalid"),"/ouvidoria/query",config)).status,403);
  assert.equal((await gateway(req(config.origin,{"X-JeriFlow-Request":""}),"/ouvidoria/query",config)).status,403);
  assert.equal((await gateway(req(config.origin,{"Sec-Fetch-Site":"cross-site"}),"/ouvidoria/query",config)).status,403);
  assert.equal(upstream.length,1);
});

test("transporte móvel reutiliza sessão protegida no cadastro e na consulta",async t=>{
  let requests=0;const server=createServer(async(req,res)=>{
    requests++;assert.equal(req.headers.authorization,"Bearer "+token);
    assert.equal(req.method,"POST");assert(req.url.startsWith("/api/v1/ouvidoria/"));
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify(req.url.endsWith("/query")?{items:[item],next:null}
      :{protocolId,status:"open",revision:1}));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const storage={get:async()=>token,set:async()=>{},remove:async()=>{}};
  const transport=bearerTransport(()=>"http://127.0.0.1:"+server.address().port,storage);
  const page=readProtocolPage(await transport.request("/ouvidoria/query",{municipalityId,scope:"meus"}));
  assert.equal(page.items.length,1);
  const mutation=protocolMutationResult(await transport.request("/ouvidoria/mutate",{
    operation:"create",municipalityId,clientRequestId:randomUUID(),category:"denuncia",
    title:"Luzes apagadas",description:"Descrição de teste, sem dados reais."
  }));
  assert.equal(mutation.status,"open");assert.equal(requests,2);
});

test("histórico é cronológico, estrito e sem identificação do servidor",()=>{
  const createdAt="2026-10-09T12:00:00.000Z";
  const items=[{code:"created",revision:1,createdAt},{code:"triaged",revision:2,createdAt},
    {code:"responded",revision:3,createdAt},{code:"closed",revision:4,createdAt}];
  assert.deepEqual(readProtocolHistory({items}).items,items);
  for(const x of [
    {items:[{...items[0],actorUserId:randomUUID()}]}, {items:[{...items[0],code:"master"}]},
    {items:[items[1],items[0]]}, {items:[{...items[0],createdAt:"invalid"}]},
    {items:[{...items[0],revision:0}]},{items:Array(21).fill(items[0])}
  ])assert.throws(()=>readProtocolHistory(x));
});
