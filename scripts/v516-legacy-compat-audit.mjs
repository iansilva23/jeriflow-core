/**
 * JeriFlow V5.16 — auditoria PRESERVATIVA de duas linhas históricas.
 * NUNCA faz merge, cherry-pick, cópia de SQL ou alteração de diretórios.
 * Compara somente migrações de um checkout legado em modo leitura
 * e da linha V5.16 em um checkout separado.
 *
 * Fonte suprema reaberta antes do commit:
 * JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip
 * SHA-256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
 * Registro: PR #9 SHA df68fe09b9e5e8ee689cc2f84511bbbcd29ee1e3.
 */
import {readdirSync,readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";

const MIGRATION=/^(\d{3})-[A-Za-z0-9_-]+\.sql$/;
const FIRST_SHARED=["001","002","003"];
const LEGACY_REQUIRED=["004","005","006","007","008","009","010",
  "011","012","013","014","015","016","017"];
const CURRENT_REQUIRED=["004","005","006","007","008","009","010",
  "020","021","022"];
const digest=content=>createHash("sha256").update(content).digest("hex");

function inventory(root){
  const dir=join(root,"infra","migrations");
  const found=new Map();
  for(const name of readdirSync(dir).sort()){
    const match=MIGRATION.exec(name);
    if(!match)continue;
    const id=match[1];
    if(found.has(id))throw Error("DUPLICATED_ORDINAL_WITHIN_BRANCH: "+id);
    const sql=readFileSync(join(dir,name),"utf8");
    found.set(id,{name,sha256:digest(sql),sql});
  }
  return found;
}
function definedSqlObjects(sql){
  const out=new Set();
  const pattern=/\bCREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|FUNCTION|VIEW|INDEX|TYPE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(app\.[a-zA-Z_][a-zA-Z0-9_]*)\b/gi;
  for(const m of sql.matchAll(pattern))out.add(m[1].toUpperCase()+" "+m[2].toLowerCase());
  return [...out].sort();
}
function guard(ok,message){
  if(!ok)throw Error("V516_LEGACY_GUARD: "+message);
}
export function auditLegacyMigrations(currentRoot,legacyRoot){
  const current=inventory(currentRoot),legacy=inventory(legacyRoot);
  for(const id of FIRST_SHARED){
    guard(current.has(id)&&legacy.has(id),"missing shared identity migration "+id);
    guard(current.get(id).sha256===legacy.get(id).sha256,
      "identity migration "+id+" drifted: MUST manually reconcile");
  }
  for(const id of LEGACY_REQUIRED)
    guard(legacy.has(id),"legacy PR #9 migration "+id+" missing");
  for(const id of CURRENT_REQUIRED)
    guard(current.has(id),"current V5.16 migration "+id+" missing");
  guard(legacy.get("017").name==="017-parking-service-requests.sql",
    "old request queue provenance changed");
  guard(current.get("020").name==="020-parking-v516-register-extensions-exit.sql",
    "original V5.16 parking registration provenance changed");
  guard(legacy.get("012").name==="012-guarda-occurrences.sql",
    "historical separate guard occurrences changed");

  const ids=[...new Set([...current.keys(),...legacy.keys()])].sort();
  const matrix=ids.map(id=>{
    const a=current.get(id),b=legacy.get(id);
    const classification=!a?"LEGACY_ONLY":!b?"CURRENT_ONLY":
      a.sha256===b.sha256?"IDENTICAL":"ORDINAL_COLLISION";
    return {
      ordinal:id,classification,
      currentPath:a?"infra/migrations/"+a.name:null,
      legacyPath:b?"infra/migrations/"+b.name:null,
      currentSha256:a?.sha256??null,legacySha256:b?.sha256??null
    };
  });
  const knownCollisions=matrix.filter(r=>r.classification==="ORDINAL_COLLISION")
    .map(r=>r.ordinal);
  guard(JSON.stringify(knownCollisions)===
    JSON.stringify(["004","005","006","007","008","009","010"]),
    "migration collision topology CHANGED: manual audit required");
  const legacyObjects=[...legacy.entries()].filter(([id])=>Number(id)>=4)
    .flatMap(([,f])=>definedSqlObjects(f.sql));
  const currentObjects=[...current.entries()].filter(([id])=>Number(id)>=4)
    .flatMap(([,f])=>definedSqlObjects(f.sql));
  const overlappingSqlObjects=[...new Set(legacyObjects)]
    .filter(o=>currentObjects.includes(o)).sort();

  // Mesmo objetos SQL de nomes distintos podem representar o MESMO fluxo:
  // guarda_occurrences e citizen_v516_traffic_protocols nunca devem ser
  // apresentados como protocolos intercambiáveis da SEMUS.
  const legacyParkingSql=legacy.get("017").sql;
  const currentParkingSql=current.get("020").sql;
  guard(/\bCREATE TABLE app\.parking_service_requests\b/.test(legacyParkingSql),
    "old request queue unexpectedly changed");
  guard(/\bCREATE TABLE app\.parking_v516_registrations\b/.test(currentParkingSql),
    "canonical parking registrations unexpectedly changed");
  guard(!/\bCREATE TABLE app\.parking_v516_registrations\b/.test(legacyParkingSql),
    "old request queue changed into canonical parking unexpectedly");

  return Object.freeze({
    mode:"READ_ONLY_NO_MERGE",
    legacySource:"PR9:df68fe09b9e5e8ee689cc2f84511bbbcd29ee1e3",
    originalZipSha256:"89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad",
    sharedIdentityUnchanged:FIRST_SHARED.length,
    ordinalCollisions:knownCollisions,
    overlappingSqlObjects,
    legacyOnly:matrix.filter(r=>r.classification==="LEGACY_ONLY")
      .map(r=>r.ordinal),
    currentOnly:matrix.filter(r=>r.classification==="CURRENT_ONLY")
      .map(r=>r.ordinal),
    warnings:[
      "Never merge old 004-017 by filename or ordinal: 004-010 have different SQL.",
      "Legacy 017 parking_service_requests is a request queue, NOT the V5.16 payment/entry/exit ledger.",
      "Legacy 012 guarda_occurrences is a separate data model, NOT the canonical SEMUS citizen traffic protocol.",
      "Do not copy historical UI/API handlers before verifying original V5.16 screen behavior.",
      "A successful schema coexistence audit alone cannot prove original UX/authorization parity."
    ],
    matrix
  });
}

const directlyExecuted=process.argv[1]&&
  fileURLToPath(import.meta.url)===resolve(process.argv[1]);
if(directlyExecuted){
  const args=process.argv.slice(2);
  if(args.length!==2){
    process.stderr.write(
      "Usage: node scripts/v516-legacy-compat-audit.mjs CURRENT_ROOT LEGACY_ROOT\n");
    process.exitCode=2;
  }else{
    try{
      const result=auditLegacyMigrations(args[0],args[1]);
      process.stdout.write(JSON.stringify(result,null,2)+"\n");
    }catch(e){
      process.stderr.write(String(e?.message??e)+"\n");
      process.exitCode=1;
    }
  }
}
