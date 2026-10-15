import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GUARD_SUPPORT_REASONS_V516} from "../apps/api/src/guard-support-service-v516.ts";

const adapter=readFileSync(new URL("../apps/api/src/guard-support-service-v516.ts",import.meta.url),"utf8");
const sql=readFileSync(new URL("../infra/migrations/026-citizen-v516-guard-support.sql",import.meta.url),"utf8");
test("apoio V5.16: motivos correspondem exatamente ao HTML original e SQL 026",()=>{
 assert.deepEqual(GUARD_SUPPORT_REASONS_V516,[
  "Necessidade de outro agente","Via bloqueada","Conflito no local","Outro"]);
 for(const reason of GUARD_SUPPORT_REASONS_V516)assert(sql.includes("'"+reason+"'"));
 assert.match(sql,/CREATE FUNCTION app\.guard_v516_support_submit/);
 assert.match(sql,/CREATE FUNCTION app\.guard_v516_support_admin_queue/);
});
test("apoio V5.16: consulta SQL existente com sessão hash e UUID da operação",()=>{
 assert.match(adapter,/app\.guard_v516_support_submit\(\$1::uuid,\$2::text,\$3::text,\$4::uuid,\$5::text,\$6::text\)/);
 assert.match(adapter,/app\.guard_v516_support_admin_queue\(\$1::uuid,\$2::text,\$3::uuid,\$4::integer\)/);
 assert.match(adapter,/sessionHash\(actor\.sessionToken\)/);
 assert.match(adapter,/uuid\(requestId\)/);
 assert.match(adapter,/uuid\(actor\.municipalityId\)/);
 assert.match(sql,/alreadyProcessed',true/);
 assert.match(sql,/role_code='admin-semus'/);
});
test("apoio V5.16: registra sem alterar ocorrência ou declarar despacho",()=>{
 assert.match(sql,/protocol_status NOT IN \('RECEBIDA','EM ATENDIMENTO'\)/);
 assert.match(sql,/SUPPORT_REQUEST_CONFLICT/);
 assert.doesNotMatch(adapter,/\b(?:sendNotification|dispatch|pushMessage)\(/);
 const server=readFileSync(new URL("../apps/api/src/server.ts",import.meta.url),"utf8");
 const main=readFileSync(new URL("../apps/api/src/main.ts",import.meta.url),"utf8");
 assert.doesNotMatch(server,/guard-support-service-v516/);
 assert.doesNotMatch(main,/guard-support-service-v516/);
});
