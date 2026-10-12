import assert from "node:assert/strict";
import {findAccessibleCenter} from "./native-guard-navigation.mjs";
import {normalizeText} from "./native-assertions.mjs";

const bounds = node => {
 const b=node.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
 if(!b)return null;
 const [,x1,y1,x2,y2]=b.map(Number);
 return x2>x1&&y2>y1?{x:Math.floor((x1+x2)/2),y:Math.floor((y1+y2)/2)}:null;
};
export function fieldCenter(xml,label,index){
 const nodes=[...xml.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]);
 const match=nodes.find(n=>/\b(?:text|content-desc)="[^"]*"/.test(n)
  && /\bclass="android\.widget\.EditText"/.test(n)
  && normalizeText(n.match(/\b(?:text|content-desc)="([^"]*)"/)?.[1]??"")===normalizeText(label));
 const field=match??nodes.filter(n=>/\bclass="android\.widget\.EditText"/.test(n))[index];
 return field?bounds(field):null;
}
/** Toques reais em uma conta FICTÍCIA no Android; nunca gera screenshot com senha. */
export async function verifyGuardAuthenticatedNavigation({adb,readHierarchy,waitFor,writeTextSecret,fixture,capture}){
 assert(fixture&&/^[a-z0-9-]+@example\.invalid$/.test(fixture.email));
 assert(/^[a-f0-9]{48}$/.test(fixture.password));
 assert(/^JF-\d{8}-\d{6}$/.test(fixture.protocolId));
 const find=async(label,scroll=false)=>{
  for(let attempt=0;attempt<(scroll?7:1);attempt++){
   try{return await waitFor(async()=>{
    const xml=await readHierarchy();
    assert(findAccessibleCenter(xml,label),"Controle esperado não visível: "+label);
    return xml;
   },scroll?3500:50000);}
   catch(error){
    if(!scroll||attempt===6)throw error;
    await adb(["shell","input","swipe","510","1510","510","470","320"]);
   }
  }
  throw Error("CONTROLE_NAO_ENCONTRADO");
 };
 const press=async(label,scroll=false)=>{
  const xml=await find(label,scroll);
  const point=findAccessibleCenter(xml,label);
  assert(point);
  await adb(["shell","input","tap",String(point.x),String(point.y)]);
 };
 await find("Bem-vindo de volta");
 let xml=await readHierarchy();
 for(const [label,index,value] of [["Email",0,fixture.email],["Senha (15 a 128 caracteres)",1,fixture.password]]){
  const center=fieldCenter(xml,label,index);
  assert(center,"Campo de login ausente: "+label);
  await adb(["shell","input","tap",String(center.x),String(center.y)]);
  // Comando protegido: NUNCA usar função adb que imprime argumentos.
  await writeTextSecret(value);
  xml=await readHierarchy();
 }
 await adb(["shell","input","keyevent","4"]); // fechar teclado sem disparar Back na tela
 await press("Entrar",true);
 await find("Conta verificada");
 await capture("login-verificado",["Conta verificada"]);
 await press(fixture.municipalityName,true);
 await find("Denúncias de trânsito");
 await find(fixture.protocolId,true);
 await press(fixture.protocolId,true);
 await find("Atender denúncia");
 await press("Atender denúncia");
 await find("Em atendimento");
 await press(fixture.protocolId,true);
 await find("Revisar finalização");
 await press("Revisar finalização",true);
 await find("Confirmar finalização");
 await press("Confirmar finalização",true);
 await find("Finalizadas");
 await find(fixture.protocolId,true);
 await capture("denuncia-finalizada",["Finalizadas",fixture.protocolId]);
 // O logout é requisito de segurança; não encerrar como aprovado sem ele.
 await press("Sair deste dispositivo",true);
 await find("Bem-vindo de volta");
 await capture("sessao-encerrada",["Bem-vindo de volta"]);
 return Object.freeze({passed:true,authenticated:true,scope:"ephemeral-fixture-only",
  steps:["login","municipio","denuncia","atender","finalizar","logout"]});
}
