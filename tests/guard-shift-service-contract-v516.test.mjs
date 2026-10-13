import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const code=readFileSync(new URL("../apps/api/src/guard-shift-service-v516.ts",import.meta.url),"utf8");
const sql=readFileSync(new URL("../infra/migrations/025-citizen-v516-guard-shift.sql",import.meta.url),"utf8");
const original=readFileSync(new URL("../apps/guarda/GuardQueueScreenV516.tsx",import.meta.url),"utf8");

test("V5.16: adaptador reutiliza APENAS funções SQL originais de plantão",()=>{
 assert.match(sql,/CREATE FUNCTION app\.guard_v516_shift_get/);
 assert.match(sql,/CREATE FUNCTION app\.guard_v516_shift_set/);
 assert.match(code,/app\.guard_v516_shift_get\(\$1::uuid,\$2::text\)/);
 assert.match(code,/app\.guard_v516_shift_set\(\$1::uuid,\$2::text,\$3::uuid,\$4::boolean\)/);
 assert.match(code,/sessionHash\(actor\.sessionToken\)/);
 assert.match(code,/uuid\(actor\.municipalityId\)/);
 assert.match(code,/uuid\(id\)/);
});
test("V5.16: valor desejado explícito e idempotência SQL, sem toggle duplicado",()=>{
 assert.match(code,/typeof onShift!=="boolean"/);
 assert.match(sql,/previous\.on_shift IS DISTINCT FROM p_on_shift/);
 assert.match(sql,/alreadyProcessed',true/);
 assert.match(sql,/IF NOT FOUND THEN[\s\S]*?'onShift',true/);
});
test("V5.16: adição isolada não substitui atendimento ou sua disponibilidade",()=>{
 assert.match(sql,/NÃO bloqueia acceptReport/);
 assert.match(original,/actions\.accept\(id\)/);
 assert.match(original,/actions\.finish\(id,data\)/);
 assert.doesNotMatch(code,/createApp\(|app\.guard_v516_accept\(/);
});
