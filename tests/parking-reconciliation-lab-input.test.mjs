import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {labMutation,labQuery} from "../apps/api/src/parking-reconciliation-lab-input.ts";
import {authMethods} from "../packages/contracts/src/identity.ts";
import {identityRoutes} from "../apps/api/src/identity-http.ts";
const municipalityId=randomUUID(),clientRequestId=randomUUID(),orderKey=randomUUID();
const caseId=randomUUID(),sampleEventId=randomUUID();
const create={operation:"create_case",municipalityId,clientRequestId,orderKey,expectedCents:8000};
const append={operation:"append_event",municipalityId,caseId,sampleEventId,
 sampleReference:"TEST_ABCDEFGH12",sampleKind:"sample_confirmation",sampleAmountCents:8000};
test("inbox de teste: esquema fechado, sem pagamento nem webhook",()=>{
 assert.deepEqual(labMutation(create),create);
 assert.deepEqual(labMutation(append),append);
 assert.deepEqual(labQuery({municipalityId,caseId}),{municipalityId,caseId});
 for(const bad of [
  {...create,expectedCents:0},{...create,expectedCents:90000001},
  {...create,expectedCents:8000.25},{...create,paid:true},
  {...create,orderKey:"invalid"},{...create,clientRequestId:"nope"},
  {...append,sampleKind:"confirmed"},{...append,sampleKind:"settled"},
  {...append,sampleReference:"REAL_ABC12"},{...append,sampleReference:"TEST_xy"},
  {...append,sampleAmountCents:-10},{...append,sampleAmountCents:50.5},
  {...append,approved:true},{...append,signature:"forged"},{...append,caseId:"invalid"},
  {...append,sampleEventId:"invalid"},{...append,sampleKind:undefined}
 ])assert.throws(()=>labMutation(bad));
 for(const bad of [{municipalityId,caseId,canCharge:true},
    {municipalityId,caseId:"invalid"},{municipalityId}])
   assert.throws(()=>labQuery(bad));
 assert.equal(authMethods["/parking/lab/mutate"],"POST");
 assert.equal(authMethods["/parking/lab/query"],"POST");
 assert.equal(identityRoutes["/api/v1/parking/lab/mutate"],"POST");
 assert.equal(identityRoutes["/api/v1/parking/lab/query"],"POST");
 assert.equal(identityRoutes["/api/v1/parking/payments/confirm"],undefined);
});
