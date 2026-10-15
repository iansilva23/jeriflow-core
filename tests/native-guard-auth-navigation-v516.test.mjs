import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fieldCenter,verifyGuardAuthenticatedNavigation,androidDisplaySizeV516,androidScrollGestureV516} from "../scripts/native-guard-auth-navigation.mjs";
const node=(attrs,x,y)=>'<node '+attrs+' bounds="['+x+','+y+']['+(x+200)+','+(y+50)+']"/>';
const xml='<hierarchy>'+node('class="android.widget.EditText" content-desc="Email"',20,100)
 +node('class="android.widget.EditText" content-desc="Senha (15 a 128 caracteres)"',20,190)+'</hierarchy>';
test("identifica os campos de email e senha pela hierarquia Android",()=>{
 assert.deepEqual(fieldCenter(xml,"Email",0),{x:120,y:125});
 assert.deepEqual(fieldCenter(xml,"Senha (15 a 128 caracteres)",1),{x:120,y:215});
});
test("o runner não deve imprimir senha nem habilitar a rede local fora da CI específica",()=>{
 const script=readFileSync("scripts/native-runner.mjs","utf8");
 assert(script.includes("verifyGuardAuthenticatedNavigation("));
 assert(script.includes("writeTextSecret:async(value)=>"));
 assert(script.includes("await runCommand(adbPath,"));
 assert(!script.includes('await adb(["shell","input","text",value])'));
 assert(script.includes('env.EXPO_PUBLIC_API_URL === "http://127.0.0.1:3001"'));
 assert(script.includes('env.GITHUB_REF==="refs/heads/feature/v516-guarda-native-login-e2e-20261012"'));
 assert(script.includes('env.GITHUB_REF==="refs/heads/feature/v516-guarda-shift-android-e2e-20261015"'));
 assert(script.includes('env.JF_NATIVE_GUARDA_SHIFT_UI_SMOKE==="1"'));
 assert(script.includes('env.JF_NATIVE_GUARDA_SHIFT_UI_SMOKE!=="1"'));
 assert(script.includes('mode&0o077,0'));
});
test("sem conta explicitamente fictícia, rejeita antes de tocar no Android",async()=>{
 let calls=0;
 await assert.rejects(verifyGuardAuthenticatedNavigation({
  adb:async()=>{calls++},
  readHierarchy:async()=>xml,waitFor:async x=>x(),
  writeTextSecret:async()=>{calls++},
  fixture:{email:"conta@empresa.real",password:"0".repeat(48),protocolId:"JF-20261012-000001"},
  capture:async()=>{}
 }));
 assert.equal(calls,0);
});

test("rolagem Android nunca usa coordenadas fora da tela física",()=>{
 const one=androidDisplaySizeV516("Physical size: 540x960");
 assert.deepEqual(one,{width:540,height:960});
 assert.deepEqual(androidScrollGestureV516(one),["270","806","270","268","320"]);
 const overridden=androidDisplaySizeV516("Physical size: 540x960\nOverride size: 1080x1920");
 assert.deepEqual(overridden,{width:1080,height:1920});
 for(const display of [one,overridden]){
  const values=androidScrollGestureV516(display).map(Number);
  assert(values[0]>=0&&values[0]<display.width);
  assert(values[1]>=0&&values[1]<display.height);
  assert(values[2]>=0&&values[2]<display.width);
  assert(values[3]>=0&&values[3]<display.height);
  assert(values[1]>values[3],"gesto desce a página em direção ao rodapé");
 }
 assert.throws(()=>androidDisplaySizeV516("Unknown screen"),/ANDROID_DISPLAY_SIZE_UNAVAILABLE/);
});
