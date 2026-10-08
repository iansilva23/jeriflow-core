import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ouvidoriaMutation, ouvidoriaQuery } from "../apps/api/src/ouvidoria-input.ts";

const municipalityId = randomUUID(), protocolId = randomUUID(), clientRequestId = randomUUID();
const newCase = { operation:"create", municipalityId, clientRequestId, category:"denuncia",
  title:"Iluminação na praça", description:"Poste apagado próximo à quadra do bairro." };
const change = {operation:"respond", municipalityId, protocolId, revision:1,
  message:"Equipe recebeu o protocolo e iniciou a avaliação."};

test("Ouvidoria: entrada válida, categoria e normalização controladas", () => {
  assert.deepEqual(ouvidoriaMutation({...newCase,title:"  Iluminação na praça  "}),newCase);
  assert.deepEqual(ouvidoriaMutation(change),change);
  assert.deepEqual(ouvidoriaMutation({operation:"triage",municipalityId,protocolId,revision:1}),
    {operation:"triage",municipalityId,protocolId,revision:1});
  assert.deepEqual(ouvidoriaQuery({municipalityId,scope:"meus"}),{municipalityId,scope:"meus",after:null});
  assert.deepEqual(ouvidoriaQuery({municipalityId,scope:"fila",after:protocolId}),
    {municipalityId,scope:"fila",after:protocolId});
});

test("Ouvidoria: recusa campos não previstos, status e payload malformados", () => {
  for (const body of [
    {...newCase,admin:true}, {...newCase,authorUserId:randomUUID()}, {...newCase,status:"closed"},
    {...newCase,category:"fiscal-tts"}, {...newCase,description:"curto"},
    {...newCase,title:"a"}, {...newCase,title:"a".repeat(121)},
    {...newCase,description:"A".repeat(4001)}, {...newCase,description:"Texto".repeat(6)+"\u0000"},
    {...newCase,municipalityId:"não-é-uuid"}, {...newCase,clientRequestId:""},
    {...change,revision:0}, {...change,revision:2.5}, {...change,message:"curto"},
    {...change,actorId:randomUUID()}, {operation:"delete",municipalityId,protocolId,revision:1},
    {operation:"contest",municipalityId,protocolId,revision:1},
    {operation:"create",municipalityId,clientRequestId,category:"denuncia",title:"Sem descrição"},
  ]) assert.throws(()=>ouvidoriaMutation(body),e=>e.code==="INVALID_INPUT");
  for(const body of [{municipalityId,scope:"outros"}, {municipalityId,scope:"meus",admin:true},
    {municipalityId:"abc",scope:"fila"},{municipalityId,scope:"meus",after:"bad"}]) {
    assert.throws(()=>ouvidoriaQuery(body),e=>e.code==="INVALID_INPUT");
  }
});

test("Ouvidoria: transições exigem revisão positiva e mensagem específica", () => {
  for(const operation of ["triage","close"]) {
    assert.equal(ouvidoriaMutation({operation,municipalityId,protocolId,revision:2}).revision,2);
    assert.throws(()=>ouvidoriaMutation({operation,municipalityId,protocolId,revision:1,message:"extra"}));
  }
  for (const operation of ["respond","contest"]) {
    assert.equal(ouvidoriaMutation({operation,municipalityId,protocolId,revision:2,
      message:"Justificativa suficiente para registrar."}).operation,operation);
    assert.throws(()=>ouvidoriaMutation({operation,municipalityId,protocolId,revision:2}));
  }
});
