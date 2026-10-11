import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const screen=readFileSync("apps/guarda/GuardAuthorizedViewV516.tsx","utf8");
const app=readFileSync("apps/guarda/App.tsx","utf8");
const auth=readFileSync("packages/mobile-auth/AuthApp.tsx","utf8");
test("Guarda V5.16: tela autorizada não montada nem altera login",()=>{
 assert(!app.includes("GuardAuthorizedViewV516"));
 assert(!auth.includes("GuardAuthorizedViewV516"));
 assert(screen.includes("guardAuthorizedActionsV516"));
 assert(screen.includes("guardEligibleMunicipalitiesV516"));
 assert(screen.includes("generation.current"));
 assert(!screen.includes("SecureStore"));
 assert(!screen.includes("fetch("));
});
