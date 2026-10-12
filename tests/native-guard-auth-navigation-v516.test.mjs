import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fieldCenter,verifyGuardAuthenticatedNavigation} from "../scripts/native-guard-auth-navigation.mjs";
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
 assert(script.includes('env.GITHUB_REF === "refs/heads/feature/v516-guarda-native-login-e2e-20261012"'));
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
