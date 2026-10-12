import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const view=readFileSync("apps/guarda/GuardAuthorizedViewV516.tsx","utf8");
const app=readFileSync("apps/guarda/App.tsx","utf8");
test("Guarda V5.16: permissão visual vinculada à conta que recebeu autorização",()=>{
 assert(view.includes("grant?.userId===context.user.id"));
 assert(view.includes("setGrant({mid,userId:context.user.id,contextKey:authorizedContextKey,actions})"));
 assert(view.includes("generation.current"));
 assert(app.includes("GuardAuthorizedViewV516"));
 assert(app.includes('process.env.EXPO_PUBLIC_GUARDA_V516_PREVIEW === "1"'));
 assert(app.includes(": undefined"));
});
