import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyGuardAndroidNavigationEvidence} from "../scripts/verify-guard-android-navigation.mjs";
import {serializeGuardNavigationHierarchy} from "../scripts/native-guard-navigation.mjs";

const png=Buffer.from([137,80,78,71,13,10,26,10,1,2]);
const node=(text)=>'<hierarchy><node text="'+text+'" bounds="[10,10][210,45]" /></hierarchy>';
const report={
 platform:"android",stage:"smoke",status:"passed",
 apps:[{id:"guarda",status:"passed",launches:[{passed:true},{passed:true}],
 anonymousNavigation:{scope:"anonymous-ui-only",passed:true,
 navigations:["login->recuperacao","recuperacao->login"],authenticated:false}}]
};
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"jf-guard-android-evidence-"));
 writeFileSync(join(dir,"report.json"),JSON.stringify(report));
 for(const [name,title] of [["guarda-recuperacao","Recuperar acesso"],["guarda-retorno-login","Bem-vindo de volta"]]){
  writeFileSync(join(dir,name+".ui.json"),serializeGuardNavigationHierarchy(node(title)));
  writeFileSync(join(dir,name+".png"),png);
 }
 return dir;
}
test("validador confere relatorio, duas transicoes, XML e PNG",()=>{
 const dir=fixture();
 try{
  const result=verifyGuardAndroidNavigationEvidence(dir);
  assert.deepEqual(result.steps,["guarda-recuperacao","guarda-retorno-login"]);
  assert.equal(result.passed,true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("rejeita o JSON corrompido observado na execução anterior",()=>{
 const dir=fixture();
 try{
  writeFileSync(join(dir,"guarda-recuperacao.ui.json"),
   serializeGuardNavigationHierarchy(node("Recuperar acesso"))+"\\n");
  assert.throws(()=>verifyGuardAndroidNavigationEvidence(dir),SyntaxError);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("não aceita captura genérica sem tela esperada nem PNG válido",()=>{
 const dir=fixture();
 try{
  writeFileSync(join(dir,"guarda-retorno-login.ui.json"),serializeGuardNavigationHierarchy(node("Outra tela")));
  assert.throws(()=>verifyGuardAndroidNavigationEvidence(dir),/controle real/);
  writeFileSync(join(dir,"guarda-retorno-login.ui.json"),serializeGuardNavigationHierarchy(node("Bem-vindo de volta")));
  writeFileSync(join(dir,"guarda-retorno-login.png"),Buffer.from("fake"));
  assert.throws(()=>verifyGuardAndroidNavigationEvidence(dir),/PNG inválido/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
