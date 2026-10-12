import assert from "node:assert/strict";
import {normalizeText} from "./native-assertions.mjs";

/** Busca texto acessível na hierarquia nativa, sem OCR nem coordenadas fixas. */
export function findAccessibleCenter(xml,label){
  const wanted=normalizeText(label);
  assert(wanted,"Texto acessível obrigatório");
  for(const match of xml.matchAll(/<node\b[^>]*>/g)){
    const node=match[0];
    const text=node.match(/\btext="([^"]*)"/)?.[1]??"";
    const desc=node.match(/\bcontent-desc="([^"]*)"/)?.[1]??"";
    if(normalizeText(text)!==wanted && normalizeText(desc)!==wanted)continue;
    const b=node.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if(!b)continue;
    const [,x1,y1,x2,y2]=b.map(Number);
    if(x2<=x1||y2<=y1)continue;
    return {x:Math.floor((x1+x2)/2),y:Math.floor((y1+y2)/2)};
  }
  return null;
}

/** Evidências de tela precisam permanecer JSON estrito e legível por ferramentas. */
export function serializeGuardNavigationHierarchy(hierarchy){
  assert(typeof hierarchy==="string"&&/<hierarchy\\b/.test(hierarchy),
    "Hierarquia Android ausente");
  return JSON.stringify({hierarchy,scope:"anonymous-ui-only"},null,2)+"\\n";
}

/** Somente navegação ANÔNIMA no APK instalado. Não executa login nem atinge API. */
export async function verifyGuardAnonymousNavigation({adb,readHierarchy,waitFor,capture}){
  const visible=async label=>await waitFor(async()=>{
    const xml=await readHierarchy();
    assert(findAccessibleCenter(xml,label),`Controle não localizado: ${label}`);
    return xml;
  },30000);
  const tap=async label=>{
    const xml=await visible(label);
    const point=findAccessibleCenter(xml,label);
    assert(point);
    await adb(["shell","input","tap",String(point.x),String(point.y)]);
  };
  await visible("Esqueci minha senha");
  await tap("Esqueci minha senha");
  const recovery=await visible("Voltar ao login");
  assert(findAccessibleCenter(recovery,"Recuperar acesso"),"Recuperação de acesso não abriu");
  await capture("guarda-recuperacao",recovery);
  await tap("Voltar ao login");
  const login=await visible("Esqueci minha senha");
  assert(findAccessibleCenter(login,"Bem-vindo de volta"),"Login não retornou");
  await capture("guarda-retorno-login",login);
  return {scope:"anonymous-ui-only",passed:true,navigations:["login->recuperacao","recuperacao->login"],authenticated:false};
}
