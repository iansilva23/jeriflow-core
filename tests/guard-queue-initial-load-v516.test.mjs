import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const screen=readFileSync("apps/guarda/GuardQueueScreenV516.tsx","utf8");
const app=readFileSync("apps/guarda/App.tsx","utf8");
test("Guarda V5.16 fila isolada inicia consulta e permite atualizar",()=>{
 assert(screen.includes('actions.load("NEW")'));
 assert(screen.includes("Atualizar fila"));
 assert(screen.includes("requestVersion.current"));
 assert(screen.includes("return ()=>{cancelled=true"));
 assert(!app.includes("GuardQueueScreenV516"));
});
