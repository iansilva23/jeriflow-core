import test from "node:test";
import assert from "node:assert/strict";
import {authMethods} from "../packages/contracts/src/identity.ts";
import {identityRoutes} from "../apps/api/src/identity-http.ts";

test("Guarda e avisos usam POST em API e BFF; download de anexo continua bloqueado",()=>{
 const paths=["/ouvidoria/notices/query","/ouvidoria/notices/read","/ouvidoria/retention/review", "/ouvidoria/retention/inventory",
              "/ouvidoria/retention/draft", "/ouvidoria/retention/archive",
              "/guarda/query","/guarda/mutate","/guarda/history"];
 for(const path of paths){
  assert.equal(authMethods[path],"POST");assert.equal(identityRoutes["/api/v1"+path],"POST");
 }
 assert.equal(authMethods["/ouvidoria/attachments/read-test"],undefined);
 assert.equal(identityRoutes["/api/v1/ouvidoria/attachments/download"],undefined);
});
