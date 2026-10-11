import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync("apps/guarda/GuardQueueScreenV516.tsx","utf8");
const app=readFileSync("apps/guarda/App.tsx","utf8");
test("Guarda V5.16 mantém a tela experimental desligada",()=>{
 assert(!app.includes("GuardQueueScreenV516"));
 assert(ui.includes('key:"NEW"'));
 assert(ui.includes('key:"IN_SERVICE"'));
 assert(ui.includes('key:"FINISHED"'));
 assert(ui.includes('Atender denúncia'));
 assert(!ui.includes("SecureStore"));
 assert(!ui.includes("fetch("));
 assert(!ui.includes("Finalizar ocorrência"));
});
