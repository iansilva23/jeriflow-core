import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync("apps/guarda/App.tsx","utf8");
const auth=readFileSync("packages/mobile-auth/AuthApp.tsx","utf8");
const lock=JSON.parse(readFileSync("package-lock.json","utf8"));
const guard=JSON.parse(readFileSync("apps/guarda/package.json","utf8"));
test("prévia Guarda V5.16 é opt-in e login permanece padrão",()=>{
 assert(app.includes('process.env.EXPO_PUBLIC_GUARDA_V516_PREVIEW === "1"'));
 assert(app.includes('PREVIEW_GUARDA_V516'));
 assert(app.includes(': undefined'));
 assert(app.includes('import * as Crypto from "expo-crypto"'));
 assert(app.includes('return Crypto.randomUUID()'));
 assert(!app.includes('globalThis.crypto?.randomUUID?.()'));
 assert(!app.includes('Math.random('));
 assert(app.includes("GUARD_SECURE_RANDOM_UNAVAILABLE"));
 assert(auth.includes("operationalHome?:"));
});

test("UUID seguro nativo fixado e integridade do pacote Expo 57",()=>{
 assert.equal(guard.dependencies["expo-crypto"],"57.0.1");
 assert.equal(lock.packages["apps/guarda"].dependencies["expo-crypto"],"57.0.1");
 const crypto=lock.packages["node_modules/expo-crypto"];
 assert.equal(crypto.version,"57.0.1");
 assert.equal(crypto.integrity,"sha512-xwegXQw3ATgeL1ZuqbSNrGzOeG+zNeh6Z6DSJk825Qpa3TEQQ1kG3ioE1p3g/SNF373BAVz2iBKUTSytlIbBRA==");
 assert(!guard.dependencies["react-native-get-random-values"]);
});
