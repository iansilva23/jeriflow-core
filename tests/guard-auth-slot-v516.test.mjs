import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const auth=readFileSync("packages/mobile-auth/AuthApp.tsx","utf8");
const app=readFileSync("apps/guarda/App.tsx","utf8");
test("slot Guarda é opcional e não altera o login instalado",()=>{
 assert(auth.includes("operationalHome?:"));
 assert(auth.includes("new AuthController(transport)"));
 assert(auth.includes("return { controller: new AuthController(transport), transport }"));
 assert(auth.includes('appId === "guarda" && operationalHome && areas.length > 0'));
 assert(auth.includes('state.context?.security.nextStep === "ready"'));
 assert(!app.includes("operationalHome"));
 assert(!app.includes("GuardAuthorizedViewV516"));
});
