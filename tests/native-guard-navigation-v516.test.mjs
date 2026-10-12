import test from "node:test";
import assert from "node:assert/strict";
import {findAccessibleCenter,verifyGuardAnonymousNavigation} from "../scripts/native-guard-navigation.mjs";

const node=(label,x=12,y=80)=>`<node index="1" text="${label}" class="android.widget.TextView" package="com.jeriflow.guarda" bounds="[${x},${y}][${x+188},${y+36}]" />`;
const login=`<hierarchy>${node("Bem-vindo de volta",10,15)}${node("Esqueci minha senha")}</hierarchy>`;
const recovery=`<hierarchy>${node("Recuperar acesso",10,15)}${node("Voltar ao login")}</hierarchy>`;

test("encontra controle acessível pelas coordenadas REAIS da hierarquia Android",()=>{
 assert.deepEqual(findAccessibleCenter(login,"Esqueci minha senha"),{x:106,y:98});
 assert.deepEqual(findAccessibleCenter(recovery,"Recuperar acesso"),{x:104,y:33});
 assert.equal(findAccessibleCenter(login,"Confirmar finalização"),null);
 assert.equal(findAccessibleCenter('<hierarchy>'+node("Esqueci minha senha",5,0).replace(/bounds="[^"]+"/,'bounds="[5,0][5,0]"')+'</hierarchy>',"Esqueci minha senha"),null);
});
test("navega login -> recuperar -> login usando toques (sem credenciais)",async()=>{
 let state="login";
 const clicks=[],shots=[];
 const adb=async(args)=>{
  assert.deepEqual(args.slice(0,3),["shell","input","tap"]);
  clicks.push(args.map(String));
  state=state==="login"?"recovery":"login";
 };
 const result=await verifyGuardAnonymousNavigation({
  adb,readHierarchy:async()=>state==="login"?login:recovery,
  waitFor:async fn=>await fn(),
  capture:async(step,xml)=>shots.push({step,xml})
 });
 assert.equal(result.passed,true);
 assert.equal(result.authenticated,false);
 assert.equal(result.scope,"anonymous-ui-only");
 assert.equal(state,"login");
 assert.equal(clicks.length,2);
 assert.deepEqual(shots.map(s=>s.step),["guarda-recuperacao","guarda-retorno-login"]);
 assert(shots[0].xml.includes("Recuperar acesso"));
});
test("rejeita falsos positivos se a navegação não ocorreu",async()=>{
 await assert.rejects(verifyGuardAnonymousNavigation({
  adb:async()=>{},readHierarchy:async()=>login,waitFor:async fn=>fn(),
  capture:async()=>{}
 }),/Controle não localizado: Voltar ao login/);
});
