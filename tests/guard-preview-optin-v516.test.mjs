import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync("apps/guarda/App.tsx","utf8");
const auth=readFileSync("packages/mobile-auth/AuthApp.tsx","utf8");
test("prévia Guarda V5.16 é opt-in e login permanece padrão",()=>{
 assert(app.includes('process.env.EXPO_PUBLIC_GUARDA_V516_PREVIEW === "1"'));
 assert(app.includes('PREVIEW_GUARDA_V516'));
 assert(app.includes(': undefined'));
 assert(app.includes('globalThis.crypto?.randomUUID?.()'));
 assert(app.includes("GUARD_SECURE_RANDOM_UNAVAILABLE"));
 assert(auth.includes("operationalHome?:"));
});
