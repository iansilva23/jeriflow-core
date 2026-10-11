import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const view=readFileSync("apps/guarda/GuardAuthorizedViewV516.tsx","utf8");
const app=readFileSync("apps/guarda/App.tsx","utf8");
test("V5.16 Guarda vincula concessão ao contexto de vínculos e permissões",()=>{
 assert(view.includes("grant?.contextKey===contextKey"));
 assert(view.includes("context.municipalities.map"));
 assert(view.includes("[...m.permissions].sort()"));
 assert(view.includes("[...m.roles].sort()"));
 assert(view.includes("context.security.nextStep"));
 assert(view.includes("authorizedContextKey"));
 assert(view.includes("[contextKey,transport]"));
 assert(app.includes('EXPO_PUBLIC_GUARDA_V516_PREVIEW === "1"'));
 assert(app.includes(": undefined"));
});
