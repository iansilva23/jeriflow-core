import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {findAccessibleCenter} from "./native-guard-navigation.mjs";

const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
const STEPS=[
  ["guarda-recuperacao","Recuperar acesso"],
  ["guarda-retorno-login","Bem-vindo de volta"]
];

/** Confere as capturas da execução REAL, não só o serializador sintético. */
export function verifyGuardAndroidNavigationEvidence(directory){
  const report=JSON.parse(readFileSync(join(directory,"report.json"),"utf8"));
  assert.equal(report.platform,"android");
  assert.equal(report.stage,"smoke");
  assert.equal(report.status,"passed");
  const guarda=report.apps?.find(app=>app.id==="guarda");
  assert(guarda,"Relatório sem app Guarda");
  assert.equal(guarda.status,"passed");
  assert.equal(guarda.launches?.length,2);
  assert.deepEqual(guarda.anonymousNavigation,{
    scope:"anonymous-ui-only",passed:true,
    navigations:["login->recuperacao","recuperacao->login"],authenticated:false
  });
  for(const [stem,label] of STEPS){
    const jsonPath=join(directory,stem+".ui.json");
    const pngPath=join(directory,stem+".png");
    assert(existsSync(jsonPath),"Evidência JSON ausente: "+stem);
    assert(existsSync(pngPath),"Captura PNG ausente: "+stem);
    const raw=readFileSync(jsonPath,"utf8");
    assert(raw.endsWith("\n"),"Evidência sem quebra de linha real: "+stem);
    const document=JSON.parse(raw);
    assert.deepEqual(Object.keys(document).sort(),["hierarchy","scope"]);
    assert.equal(document.scope,"anonymous-ui-only");
    assert.equal(typeof document.hierarchy,"string");
    assert(findAccessibleCenter(document.hierarchy,label),
      "Tela não confirma o controle real: "+label);
    const png=readFileSync(pngPath);
    assert(png.length>PNG.length&&png.subarray(0,PNG.length).equals(PNG),
      "PNG inválido: "+stem);
  }
  return {passed:true,scope:"anonymous-ui-only",steps:STEPS.map(([stem])=>stem)};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dir=resolve(process.argv[2]??"artifacts/native/android/guarda");
  const outcome=verifyGuardAndroidNavigationEvidence(dir);
  console.log(JSON.stringify(outcome));
}
