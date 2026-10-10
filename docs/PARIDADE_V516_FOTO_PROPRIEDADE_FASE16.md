# JeriFlow V5.16 — Fase 16: reserva da foto vinculada à sessão e município

**Regra suprema aplicada:** abri o ZIP original `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, validei SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad` e `unzip -t` sem erros **antes de editar**. Fonte dos únicos fluxos permitidos: `cidadao-ai/index.html` e `shared/jeriflow-audit-citizen.js` `formIdentity()`, `evidence()`, `submitTrafficForm()` e `visible()`, além dos HTML Guarda/SEMUS.

## Por que a correção é necessária

As migrações 005–006 exigem fotografia verificada pelo worker privado mas ainda não conferem que a fotografia pertence à conta que emite o protocolo. Apenas conhecer o ID e SHA de uma mídia anteriormente registrada não deve dar direito de usá-la. O HTML V5.16 associa protocolos ao cidadão logado ou ao `deviceId` armazenado localmente para visitantes; **`localStorage` sozinho NÃO prova a posse de um dispositivo na API**.

## Alterações exclusivamente internas

1. `infra/migrations/007-citizen-v516-traffic-photo-owner.sql`: adiciona tabela privada `app.citizen_v516_traffic_photo_owners` (foto UUID, município, conta, SHA e data de reserva). É uma reserva técnica, **não um status novo** do formulário. API `jeriflow_app` não lê/edita a tabela; worker de foto não a lê/edita.
2. Função reservada `app.citizen_v516_reserve_traffic_photo(mid, hash_sessão, uuid_foto, sha_foto)` revalida, no PostgreSQL, a sessão ativa, município, conta e moderação; registra só uma reserva por UUID emitida pelo armazenamento privado. Não aceita `citizenId` informado pelo aplicativo nem dá baixa no scanner.
3. Trigger `citizen_v516_traffic_owner_gate` da tabela **CANÔNICA** `app.citizen_v516_traffic_protocols`: no INSERT ou mudança de propriedades de titularidade, exige a mesma UUID/município/conta/SHA de uma reserva. O gate 005 continua exigindo fotografia efetivamente registrada pelo scanner. Falha se a foto for de outro cidadão ou se não houver reserva.
4. **Visitante:** continua existindo no HTML original, sem alterar a UI. Mas, até estabelecer um token de dispositivo confiável e sua titularidade, o backend da migração 007 falha fechado para `guest_device_hash` auto-declarado. Não transformar `deviceId` arbitrário em autorização de evidência.
5. `apps/api/src/traffic-photo-ownership-v516.ts`: biblioteca interna usada exclusivamente após o armazenamento/normalização real emitir `CleanPhotoTicketV516`, recebendo token de sessão vindo de Bearer autenticado. Não exporta HTTP ou URL e não é conectada à rota opt-in da PR #30.
6. `tests/integration/traffic-photo-ownership-v516.test.mjs`: PostgreSQL **real** descartável, migrações 001–007, credenciais separadas do scanner e da API; testes de posse A/B, município, foto sem scan, foto sem reserva, protocolo único, replay, revogação, banimento e guest não provado. Mais regressões HTML/HTTP.

## Limites e pendências

- O fluxo end-to-end **não foi habilitado**. O transporte da PR #30 permanece opt-in e **503 no `main.ts` atual**. Nenhuma foto real foi enviada a Guarda/SEMUS.
- A reserva permite preceder a varredura; ainda falta orquestrar no backend de confiança: upload, quarentena, normalização, store, reserva da titularidade, scanner oficial, registro privado no gate, transação do protocolo e descarte seguro de mídia órfã/duplicada.
- Garantir limpeza de reservas expiradas, rate limits/quotas por conta/tenant/IP, LGPD/retenção, scanner atualizado no serviço isolado, anti-replay de visitantes, transições RN e homologação real de dispositivos.
- Não conectar/provisionar scanner no VPS sem autorização separada. Não alterar a UI/identidade/categorias/pagamentos/regras da V5.16, nem criar protocolo paralelo.
- **Branch empilhada em PR #30**, rascunho, sem merge ou alteração da `main`, VPS ou Ramo Nessa.

**Design de segurança importante:** a reserva não comprova, isoladamente, que um arquivo existiu, pois o SQL não vê bytes. Somente o fluxo backend que usa um ticket gerado pelo store privado E o gate criado pelo scanner do banco consegue produzir o protocolo. Nunca aceitar um `CleanPhotoTicketV516` do JSON do Cidadão.
