import test from "node:test";
import assert from "node:assert/strict";
import {
 TRAFFIC_TYPES_V516,SERVICE_ACTIONS_V516,SERVICE_RESULTS_V516,
 validateTrafficDraftV516,trafficProtocolAfterVerifiedPhotoV516,
 acceptTrafficV516,finishTrafficV516,reopenTrafficV516,
 administrativeFinishTrafficV516,flagCitizenV516,
} from "../packages/contracts/src/citizen-traffic-v516.ts";

const guest={registered:false,citizenId:"",name:"Pessoa Exemplo",birthDate:"1990-08-01",
 phone:"(88) 99999-0000",address:"",login:""};
const guard={id:"guard-1",name:"Guarda Exemplo",login:"guarda-teste"};
const admin={id:"admin-1",name:"ADM SEMUS",login:"admin-semus-teste"};
const at1="2026-10-10T09:00:00.000Z",at2="2026-10-10T10:00:00.000Z";
const draft={type:TRAFFIC_TYPES_V516[0],location:"Rua exemplo",
 plate:"abc1d23",description:"Veículo em local irregular",photoSelected:true,identity:guest};
const verified=()=>validateTrafficDraftV516(draft);
const original=()=>trafficProtocolAfterVerifiedPhotoV516(verified(),true,"JF-TEST-001",at1);

test("V5.16: as sete opções do menu Trânsito são as originais",()=>{
 assert.deepEqual(TRAFFIC_TYPES_V516,[
  "Estacionamento irregular","Veículo bloqueando acesso/garagem",
  "Veículo em área proibida","Via parcialmente bloqueada","Circulação irregular",
  "Transporte irregular","Outro problema de trânsito"]);
 assert.equal(new Set(TRAFFIC_TYPES_V516).size,7);
});
test("V5.16: todos os seletores de atendimento da Guarda coincidem",()=>{
 assert.deepEqual(SERVICE_RESULTS_V516,[
  "Veículo encontrado","Veículo não encontrado","Situação já resolvida","Denúncia não confirmada"]);
 assert.deepEqual(SERVICE_ACTIONS_V516,[
  "Orientação realizada","Autuação realizada","Veículo removido/direcionado",
  "Solicitado apoio","Sem providência necessária"]);
});
test("V5.16: erros seguem a ordem exata do submitTrafficForm",()=>{
 for(const [patch,message] of [
  [{type:""},"Selecione o tipo de ocorrência."],
  [{type:"tipo inventado"},"Selecione o tipo de ocorrência."],
  [{location:" "},"Informe o local da ocorrência."],
  [{description:" "},"Descreva o que está acontecendo."],
  [{photoSelected:false},"A foto é obrigatória para enviar a denúncia."],
  [{identity:null},"Informe nome completo, data de nascimento e telefone."],
  [{identity:{...guest,name:""}},"Informe nome completo, data de nascimento e telefone."],
  [{identity:{...guest,birthDate:""}},"Informe nome completo, data de nascimento e telefone."],
  [{identity:{...guest,phone:""}},"Informe nome completo, data de nascimento e telefone."],
  [{submissionBlocked:true},"Sua conta possui uma restrição administrativa ativa e não pode enviar novas solicitações."],
 ])assert.deepEqual(validateTrafficDraftV516({...draft,...patch}),{ok:false,message});
});
test("V5.16: formulário conserva o texto, normaliza placa e identidade",()=>{
 const value=validateTrafficDraftV516({...draft,type:" Veículo em área proibida ",
  location:" Avenida exemplo ",plate:" aBc-123 ",description:" Teste de descrição "});
 assert.equal(value.ok,true);
 if(!value.ok)throw Error("unexpected");
 assert.equal(value.fields.type,"Veículo em área proibida");
 assert.equal(value.fields.location,"Avenida exemplo");
 assert.equal(value.fields.plate,"ABC-123");
 assert.equal(value.fields.description,"Teste de descrição");
 assert.equal(value.fields.identity.name,guest.name);
 assert.equal(value.fields.photoSelected,true);
});
test("V5.16: placa opcional, no máximo 8 caracteres de input",()=>{
 const empty=validateTrafficDraftV516({...draft,plate:""});
 assert.equal(empty.ok,true);
 assert.equal(validateTrafficDraftV516({...draft,plate:"ABCD12345"}).ok,false);
});
test("V5.16: cidadão cadastrado usa identidade vinculada",()=>{
 const identity={...guest,registered:true,citizenId:"citizen-001",login:"pessoa01"};
 const value=validateTrafficDraftV516({...draft,identity});
 assert.equal(value.ok,true);
 if(value.ok)assert.deepEqual(value.fields.identity,identity);
});
test("Sem foto efetivamente verificada NÃO se constrói protocolo",()=>{
 assert.throws(()=>trafficProtocolAfterVerifiedPhotoV516(verified(),false,"JF-1",at1),/TRAFFIC_V516_NOT_READY/);
 assert.throws(()=>trafficProtocolAfterVerifiedPhotoV516(verified(),true,"",at1),/TRAFFIC_V516_NOT_READY/);
 assert.throws(()=>trafficProtocolAfterVerifiedPhotoV516(verified(),true,"JF-1","invalid"),/TRAFFIC_V516_NOT_READY/);
 assert.throws(()=>trafficProtocolAfterVerifiedPhotoV516(
  validateTrafficDraftV516({...draft,photoSelected:false}),true,"JF-1",at1),/TRAFFIC_V516_NOT_READY/);
});
test("V5.16: criar protocolo com destino/status/ID únicos do Cidadão",()=>{
 const p=original();
 assert.equal(p.id,"JF-TEST-001");assert.equal(p.title,draft.type);
 assert.equal(p.category,"Trânsito (SEMUS)");
 assert.equal(p.destination,"SEMUS / Guarda de trânsito");
 assert.equal(p.status,"RECEBIDA");assert.equal(p.hasPhoto,true);
 assert.equal(p.identity.name,guest.name);assert.deepEqual(p.meta,["Rua exemplo","ABC1D23"]);
 assert.equal(p.acceptedAt,undefined);assert.equal(p.finishedAt,undefined);
});
test("V5.16: Guarda assume o MESMO protocolo, sem criar segundo ID",()=>{
 const first=original(),accepted=acceptTrafficV516(first,guard,at2);
 assert.equal(accepted.id,first.id);
 assert.equal(accepted.status,"EM ATENDIMENTO");
 assert.deepEqual(accepted.assignedGuard,guard);
 assert.equal(accepted.acceptedAt,at2);
 assert.equal(first.status,"RECEBIDA");
 assert.throws(()=>acceptTrafficV516(accepted,guard,at2),/INVALID_TRAFFIC_TRANSITION/);
 assert.throws(()=>acceptTrafficV516(first,{...guard,id:""},at2),/UNAUTHORIZED_GUARD/);
});
test("V5.16: Guarda finaliza e preserva a mesma identidade/protocolo",()=>{
 const accepted=acceptTrafficV516(original(),guard,at2);
 const done=finishTrafficV516(accepted,guard,"2026-10-10T11:00:00Z",
  "Veículo encontrado","Orientação realizada","");
 assert.equal(done.id,accepted.id);assert.equal(done.status,"FINALIZADA");
 assert.deepEqual(done.finishedBy,guard);assert.equal(done.serviceNote,"");
 assert.equal(done.serviceResult,"Veículo encontrado");
 assert.equal(done.serviceAction,"Orientação realizada");
 assert.deepEqual(done.identity,accepted.identity);
 assert.equal(accepted.status,"EM ATENDIMENTO");
});
test("V5.16: resultado e providência precisam ser opções originais",()=>{
 const accepted=acceptTrafficV516(original(),guard,at2);
 assert.throws(()=>finishTrafficV516(accepted,guard,at2,"Multa automática","Orientação realizada",""),
  /INVALID_TRAFFIC_TRANSITION/);
 assert.throws(()=>finishTrafficV516(accepted,guard,at2,"Veículo encontrado","Cobrança online",""),
  /INVALID_TRAFFIC_TRANSITION/);
 assert.throws(()=>finishTrafficV516(original(),guard,at2,"Veículo encontrado","Orientação realizada",""),
  /INVALID_TRAFFIC_TRANSITION/);
});
test("V5.16: SEMUS reabre ocorrência finalizada, mantém histórico e mesmo ID",()=>{
 const done=finishTrafficV516(acceptTrafficV516(original(),guard,at2),guard,
  "2026-10-10T11:00:00Z","Situação já resolvida","Sem providência necessária","");
 const reopened=reopenTrafficV516(done,"ADM SEMUS","2026-10-10T12:00:00Z");
 assert.equal(reopened.id,done.id);assert.equal(reopened.status,"RECEBIDA");
 assert.equal(reopened.acceptedAt,null);assert.equal(reopened.finishedAt,null);
 assert.equal(reopened.assignedGuard,null);assert.equal(reopened.finishedBy,null);
 assert.equal(reopened.semusAdministrativeHistory?.[0]?.action,"REABERTA");
 assert.equal(reopened.semusAdministrativeHistory?.[0]?.previousStatus,"FINALIZADA");
 assert.deepEqual(done.semusAdministrativeHistory,undefined);
 assert.throws(()=>reopenTrafficV516(reopened,"ADM SEMUS",at2),/INVALID_TRAFFIC_TRANSITION/);
});
test("V5.16: SEMUS pode encerrar administrativamente com motivo, sem novo protocolo",()=>{
 const done=administrativeFinishTrafficV516(original(),admin,"Situação averiguada",at2);
 assert.equal(done.status,"FINALIZADA");
 assert.equal(done.id,original().id);
 assert.equal(done.serviceResult,"Encerrada administrativamente");
 assert.equal(done.serviceAction,"Decisão administrativa");
 assert.equal(done.serviceNote,"Situação averiguada");
 assert.throws(()=>administrativeFinishTrafficV516(original(),admin,"   ",at2),/ADMIN_REASON_REQUIRED/);
});
test("V5.16: agente sinaliza denunciante PARA ANÁLISE, sem punição automática",()=>{
 const first=acceptTrafficV516(original(),guard,at2);
 const flagged=flagCitizenV516(first,guard,"Possível informação falsa","Verificar documentos",at2);
 assert.equal(flagged.id,first.id);assert.equal(flagged.citizenFlag?.status,"EM ANÁLISE");
 assert.equal(flagged.citizenFlag?.reason,"Possível informação falsa");
 assert.equal(flagged.status,"EM ATENDIMENTO");
 assert.equal(first.citizenFlag,undefined);
 assert.equal("blocked" in flagged,false);
});
test("Contrato não define PSP, pagamento, tarifa ou fonte paralela",()=>{
 const record=original();
 assert.equal("paymentMethod" in record,false);
 assert.equal("paidUntil" in record,false);
 assert.equal("tariff" in record,false);
 assert.equal("guardaOccurrenceId" in record,false);
});
