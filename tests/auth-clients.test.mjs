import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { AuthController } from "../packages/auth/controller.ts";
import { apiBase, bearerTransport, AuthFailure } from "../packages/auth/client.ts";
import { canonicalToken } from "../packages/contracts/src/identity.ts";
import { gateway, cookieToken, serverContext, sessionCookie } from "../apps/admin/lib/gateway.ts";

async function server(t, handle) {
  const instance = createServer(handle);
  await new Promise(resolve => instance.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return "http://127.0.0.1:" + instance.address().port;
}
const token = () => randomBytes(32).toString("base64url");
const json = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const vault = () => ({ value: null, async get() { return this.value; }, async set(v) { this.value = v; }, async remove() { this.value = null; } });
const config = api => ({ api, origin: "https://admin.example.invalid" });
function browserRequest(path, { body = {}, origin = "https://admin.example.invalid", cookie, ...headers } = {}) {
  return new Request("https://admin.example.invalid/api/identity" + path, { method: "POST", headers: {
    "Content-Type": "application/json", Origin: origin, Host: "admin.example.invalid", "X-JeriFlow-Request": "1", ...(cookie ? { Cookie: cookie } : {}), ...headers,
  }, body: JSON.stringify(body) });
}
test("clientes recusam destinos inseguros, tokens não canônicos e cookies duplicados", () => {
  for (const url of [undefined, "http://api.example.invalid", "https://x.invalid/api", "https://user:pass@x.invalid", "https://x.invalid/?redirect=x", "https://x.invalid/#x", "file:///tmp/test"]) assert.throws(() => apiBase(url));
  assert.equal(apiBase("https://api.example.invalid/"), "https://api.example.invalid");
  assert.throws(() => apiBase("http://127.0.0.1:3001"));
  assert.equal(apiBase("http://127.0.0.1:3001", true), "http://127.0.0.1:3001");
  const value = token(); assert(canonicalToken(value)); assert(!canonicalToken(value.slice(0,42)+"B"));
  assert.equal(cookieToken(`${sessionCookie}=${value}; other=1`), value);
  assert.equal(cookieToken(`${sessionCookie}=${value}; ${sessionCookie}=${value}`), undefined);
});
test("BFF esconde Bearer, emite cookie seguro e rejeita CSRF/métodos/destinos antes da API", async t => {
  const value = token(); let calls = 0;
  const api = await server(t, (req,res) => { calls++; assert.equal(req.url,"/api/v1/auth/login"); assert.equal(req.headers.authorization,undefined); json(res,200,{ accessToken:value,expiresAt:new Date(Date.now()+3600000).toISOString(),nextStep:"ready" }); });
  const cfg = config(api), path = "/auth/login";
  const accepted = await gateway(browserRequest(path,{ Authorization:"Bearer attacker", "X-Platform-Admin":"true" }),path,cfg);
  assert.equal(accepted.status,200); assert(!JSON.stringify(await accepted.json()).includes(value));
  const cookie = accepted.headers.get("set-cookie"); assert(cookie.includes(value));
  for (const flag of ["HttpOnly","Secure","SameSite=Strict","Path=/"]) assert(cookie.includes(flag));
  assert.equal(accepted.headers.get("cache-control"),"no-store");
  for (const h of [{origin:"https://evil.invalid"},{"X-JeriFlow-Request":""},{"Sec-Fetch-Site":"cross-site"},{Host:"evil.invalid"}]) assert.equal((await gateway(browserRequest(path,h),path,cfg)).status,403);
  assert.equal((await gateway(browserRequest(path,{"Content-Type":"text/plain"}),path,cfg)).status,415);
  assert.equal((await gateway(new Request(cfg.origin+"/api/identity/auth/login",{headers:{Host:"admin.example.invalid"}}),path,cfg)).status,405);
  assert.equal((await gateway(browserRequest("/auth/login?x=1"),path,cfg)).status,404);
  assert.equal((await gateway(browserRequest("/access"),"/access",cfg)).status,404);
  assert.equal((await gateway(browserRequest("/auth/logout"),"/auth/logout",cfg)).status,401);
  assert.equal(calls,1);
});
test("normalização local do Next preserva validação exata de Host e origem",async()=>{
  const cfg={origin:"http://127.0.0.1:3000",api:"http://127.0.0.1:1"};
  const path="/auth/me",url="http://localhost:3000/api/identity"+path;
  assert.equal((await gateway(new Request(url,{headers:{Host:"127.0.0.1:3000"}}),path,cfg)).status,401);
  assert.equal((await gateway(new Request(url,{headers:{Host:"localhost:3000"}}),path,cfg)).status,403);
  assert.equal((await gateway(new Request(url.replace(":3000",":3002"),{headers:{Host:"127.0.0.1:3000"}}),path,cfg)).status,403);
});
test("BFF limita tamanho e prazo de leitura inclusive JSON válido com corpo nunca encerrado", async () => {
  const cfg = config("http://127.0.0.1:1"), path="/auth/login";
  assert.equal((await gateway(browserRequest(path,{body:{x:"x".repeat(9000)}}),path,cfg)).status,413);
  const input = browserRequest(path);
  const stream = new ReadableStream({start(c){ c.enqueue(new TextEncoder().encode("{}")); }});
  const request = new Request(input.url,{method:"POST",headers:input.headers,body:stream,duplex:"half"});
  const started=Date.now(); const result=await gateway(request,path,cfg);
  assert.equal(result.status,400); assert(Date.now()-started < 6500);
});
test("BFF não libera sessão offline e logout distingue remoção local de revogação remota", async () => {
  const cfg=config("http://127.0.0.1:1"), cookie=`${sessionCookie}=${token()}`;
  await assert.rejects(serverContext(cookie,cfg));
  const result=await gateway(browserRequest("/auth/logout",{cookie}),"/auth/logout",cfg);
  assert.equal(result.status,200); assert.equal((await result.json()).remoteRevoked,false);
  assert(result.headers.get("set-cookie").includes("Max-Age=0"));
  const all=await gateway(browserRequest("/auth/logout-all",{cookie}),"/auth/logout-all",cfg);
  assert.equal(all.status,503); assert.equal(all.headers.get("set-cookie"),null);
});
test("adapter nativo restaura sessão, preserva desafio inválido e apaga token revogado", async t => {
  const value=token(), storage=vault(); let authorized;
  const api=await server(t,(req,res)=>{
    authorized=req.headers.authorization;
    if(req.url.endsWith("/login")) json(res,200,{accessToken:value});
    else if(req.url.endsWith("/challenge")) json(res,401,{error:"INVALID_FACTOR"});
    else json(res,401,{error:"UNAUTHORIZED"});
  });
  const first=bearerTransport(()=>api,storage);
  const login=await first.request("/auth/login",{}); assert.equal(login.accessToken,undefined); assert.equal(storage.value,value);
  const restored=bearerTransport(()=>api,storage);
  await assert.rejects(restored.request("/auth/mfa/challenge",{code:"000000"}),e=>e.code==="INVALID_FACTOR");
  assert.equal(authorized,"Bearer "+value); assert.equal(storage.value,value);
  await assert.rejects(restored.request("/auth/me"),e=>e.code==="UNAUTHORIZED"); assert.equal(storage.value,null);
});
test("falha no cofre nativo revoga a sessão recém-criada e nunca aprova o login", async t => {
  const value=token(); let revoked=false;
  const api=await server(t,(req,res)=>{
    if(req.url.endsWith("/login")) json(res,200,{accessToken:value});
    else { revoked=req.headers.authorization==="Bearer "+value && req.url.endsWith("/logout"); json(res,200,{}); }
  });
  const storage=vault(); storage.set=async()=>{throw new Error("disk unavailable");};
  const client=new AuthController(bearerTransport(()=>api,storage)); await client.refresh(); await client.login("test@example.invalid","a long test password");
  assert.equal(client.snapshot().mode,"login"); assert(client.snapshot().error); assert(revoked); assert.equal(storage.value,null);
});
test("códigos emitidos sobrevivem a indisponibilidade posterior; clique duplo não repete emissão", async () => {
  const codes=Array.from({length:10},()=>randomBytes(16).toString("hex")); let calls=0,finish;
  const transport={clear:async()=>{},request:async(path)=>{calls++; if(path==="/auth/mfa/enroll/confirm") { await new Promise(resolve=>{finish=resolve;}); return {recoveryCodes:codes}; } throw new AuthFailure("NETWORK");}};
  const client=new AuthController(transport);
  const first=client.confirmEnrollment("123456"); await client.confirmEnrollment("123456"); finish(); await first;
  assert.equal(calls,1); assert.equal(client.snapshot().mode,"backup"); assert.deepEqual(client.snapshot().codes,codes);
  await client.acknowledgeBackups(); assert.equal(client.snapshot().mode,"unavailable"); assert.equal(client.snapshot().codes,undefined);
});
