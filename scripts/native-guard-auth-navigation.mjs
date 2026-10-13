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
/** Coordenadas derivadas do próprio emulador, nunca de pixels fixos. */
export function androidDisplaySizeV516(raw){
 const matches=[...String(raw).matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)];
 if(!matches.length)throw new Error("ANDROID_DISPLAY_SIZE_UNAVAILABLE");
 const [,w,h]=matches[matches.length-1];
 const width=Number(w),height=Number(h);
 assert(Number.isSafeInteger(width)&&Number.isSafeInteger(height)
   &&width>=320&&height>=480&&width<=8192&&height<=8192,
   "ANDROID_DISPLAY_SIZE_INVALID");
 return {width,height};
}
export function androidScrollGestureV516({width,height}){
 return [String(Math.floor(width/2)),String(Math.floor(height*.84)),
  String(Math.floor(width/2)),String(Math.floor(height*.28)),"320"];
}

/** Toques reais em uma conta FICTÍCIA no Android; nunca gera screenshot com senha. */
export async function verifyGuardAuthenticatedNavigation({adb,readHierarchy,waitFor,writeTextSecret,fixture,capture}){
 assert(fixture&&/^[a-z0-9-]+@example\.invalid$/.test(fixture.email));
 assert(/^[a-f0-9]{48}$/.test(fixture.password));
 assert(/^JF-\d{8}-\d{6}$/.test(fixture.protocolId));
 const visibleMarkers=[
  // Estado de login sem emails, tokens ou conteúdo de senha.
  "Bem-vindo de volta","Entrar","Aguarde…","Verificando sua sessão…",
  "Conexão indisponível","Tentar novamente","Sua conta está protegida.",
  "Conta verificada","Guarda / SEMUS","Denúncias de trânsito","Novas",
  "Em atendimento","Finalizadas","Atualizar fila","Voltar à fila",
  "Atender denúncia","Revisar finalização","Confirmar finalização",
  "Nenhum protocolo nesta fila. Atualize para consultar novamente.",
  "Não foi possível carregar a fila. Tente atualizar.",
  "Não foi possível confirmar a operação. Atualize a fila para conferir o estado antes de tentar novamente.",
  fixture.protocolId
 ];
 const visibility=async()=>{
  // Apenas rótulos públicos/sintéticos permitidos — nunca email ou senha.
  const screen=await readHierarchy();
  const allowedCodes=["GUARD_SECURE_RANDOM_UNAVAILABLE","INVALID_GUARD_MUTATION",
   "INVALID_GUARD_REQUEST_ID","GUARD_ACCESS_DENIED","GUARD_OPERATION_ALREADY_CONFIRMED",
   "GUARD_RETRY_PAYLOAD_CHANGED","NETWORK","UNAUTHORIZED","INVALID_RESPONSE",
   "GUARD_MUTATION_UNAVAILABLE","GUARD_SERVICE_UNAVAILABLE","OTHER"];
  const allowedStatus=[0,400,401,403,404,409,422,429,500,503];
  const diagnosticLabels=allowedCodes.flatMap(code=>allowedStatus.map(status=>
   "JF_GUARDA_E2E_OPERATION_CAUSE:"+code+":HTTP"+status));
  return [...visibleMarkers,...diagnosticLabels].filter(label=>findAccessibleCenter(screen,label)!==null);
 };
 let display=null;
 const scrollDown=async()=>{
  display??=androidDisplaySizeV516(await adb(["shell","wm","size"]));
  await adb(["shell","input","swipe",...androidScrollGestureV516(display)]);
 };
 const find=async(label,scroll=false)=>{
  for(let attempt=0;attempt<(scroll?7:1);attempt++){
   try{return await waitFor(async()=>{
    const xml=await readHierarchy();
    assert(findAccessibleCenter(xml,label),"Controle esperado não visível: "+label);
    return xml;
   },scroll?3500:12000);}
   catch(error){
    if(!scroll||attempt===6){
     const markers=await visibility().catch(()=>[]);
     throw new Error("UI_CONTROL_MISSING: "+label+"; visible: "+markers.join(" | "),{cause:error});
    }
    await scrollDown();
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
 for(const [label,index,value] of [["Email",0,fixture.email],["Senha (15 a 128 caracteres)",1,fixture.password]]){
  // Recalcular coordenadas após cada teclado: ao ganhar foco o Android
  // redimensiona a tela e pode ocultar o campo seguinte do uiautomator.
  const center=await waitFor(async()=>{
   const current=await readHierarchy();
   const point=fieldCenter(current,label,index);
   assert(point,"Campo de login ausente: "+label);
   return point;
  },15000);
  await adb(["shell","input","tap",String(center.x),String(center.y)]);
  // Comando protegido: NUNCA usar função adb que imprime argumentos.
  await writeTextSecret(value);
  // Fecha teclado imediatamente; não manter senha na árvore XML ou nas capturas.
  await adb(["shell","input","keyevent","4"]);
 }
 await find("Bem-vindo de volta");
 await press("Entrar",true);
 await find("Conta verificada");
 await capture("login-verificado",["Conta verificada"]);
 await press(fixture.municipalityName,true);
 await find("Denúncias de trânsito");
 await find(fixture.protocolId,true);
 await press(fixture.protocolId,true);
 // Confirmar montagem real do detalhe antes de procurar a ação abaixo.
 await find("Voltar à fila");
 await capture("detalhe-aberto",["Voltar à fila",fixture.protocolId]);
 // No detalhe V5.16, a ação fica abaixo das informações do protocolo.
 // A hierarquia Android lista apenas os controles na área visível.
 await press("Atender denúncia",true);
 await find("Em atendimento");
 await press(fixture.protocolId,true);
 // Formulário V5.16: 4 situações, 5 providências e observação antes
 // dos botões. No Android estes controles começam fora da área visível.
 await find("Revisar finalização",true);
 await press("Revisar finalização",true);
 await find("Confirmar finalização",true);
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
