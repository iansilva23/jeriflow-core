import test from "node:test";
import assert from "node:assert/strict";
import { mobileApps, adminPanels } from "../packages/contracts/src/catalog.ts";
import { createApp } from "../apps/api/src/server.ts";
import { readFileSync } from "node:fs";

test("inventário: quatro apps e sete painéis, sem app transporte", () => {
  assert.equal(mobileApps.length,4);
  assert.equal(adminPanels.length,7);
  assert.equal(new Set(mobileApps.map(x=>x.id)).size,4);
  assert(mobileApps.some(x=>x.id==="fiscal-tts"));
  assert(!mobileApps.some(x=>x.id==="transporte"));
  assert(!adminPanels.some(x=>x.id==="fiscal-tts"));
});
test("todos os pacotes são privados e apps possuem identidades diferentes", () => {
  const ids = [];
  for (const a of mobileApps) {
    const p=JSON.parse(readFileSync(new URL("../apps/"+a.id+"/package.json",import.meta.url)));
    const c=JSON.parse(readFileSync(new URL("../apps/"+a.id+"/app.json",import.meta.url)));
    assert.equal(p.private,true);
    ids.push(c.expo.android.package);
    assert.equal(c.expo.android.package,c.expo.ios.bundleIdentifier);
    assert.deepEqual(c.expo.platforms,["ios","android"]);
    assert.equal(c.expo.android.allowBackup,false);
    assert(c.expo.android.blockedPermissions.includes("android.permission.RECORD_AUDIO"));
  }
  assert.equal(new Set(ids).size,4);
});
test("API não simula backend pronto nem autorizações TTS", async () => {
  const server=createApp();
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const url="http://127.0.0.1:"+server.address().port;
  try {
    for (const [path,status] of [["/health/live",200],["/health/ready",503],["/api/v1/tts/verify",503],["/missing",404]]) {
      const r=await fetch(url+path);
      assert.equal(r.status,status);
      assert.equal(r.headers.get("cache-control"),"no-store");
      assert(r.headers.get("x-request-id"));
      assert(!JSON.stringify(await r.json()).includes("password"));
    }
    const r=await fetch(url+"/health/live",{method:"POST"});
    assert.equal(r.status,405);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
