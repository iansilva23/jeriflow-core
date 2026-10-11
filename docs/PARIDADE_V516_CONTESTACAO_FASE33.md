# JeriFlow V5.16 — Fase 33: contestação do denunciante e decisão administrativa

## Supremacia da referência e preservação

ZIP `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, `unzip -t` íntegro, relido antes de editar. Fontes: `cidadao-ai/index.html` `contestModal`, `shared/jeriflow-audit-citizen.js` `openCitizenContest/sendCitizenContest`, `shared/jeriflow-audit-admin-semus.js` e `shared/jeriflow-audit-admin-cidadao.js` `reviewContestation`.

A PR #47 define os cinco motivos de Guarda e as decisões `ARQUIVADA`/`ANALISADA`. **Essa é a revisão inicial do reporte, não a decisão da contestação do cidadão.** A contestação usa o estado `ENVIADA`, e os dois painéis ADMs originais permitem `ACOLHIDA` e `NÃO ACOLHIDA`, com justificativa mínima de 5 caracteres. A contestação é do titular e exige explicação mínima de 10 caracteres.

## Implementação privada, sem sobrescrita

- Migração NOVA `028-citizen-v516-flag-contestation.sql` sem modificar 001–027 nem a tabela canônica de protocolo. Uma contestação registrada por protocolo e conta, ligada à sinalização já enviada.
- `citizen_v516_flag_contestant` autentica sessão real de Cidadão da migração 004; confere `citizen_account_id` e `municipality_id` do próprio protocolo no servidor. Nenhuma identificação informada no corpo da requisição pode substituir a sessão; visitantes com `deviceId` local não ganham acesso.
- `citizen_v516_flag_contest_submit` registra texto 10–2000 caracteres, hash de sessão, UUID idempotente; não aceita reenvio com conteúdo ou intenção diferentes, nem cria contestação sem sinalização.
- `citizen_v516_flag_contest_mine` permite somente ao verdadeiro titular consultar razão, revisão, estado do próprio recurso e justificativa. Não revela a identidade do guarda ou dados de outra conta.
- `citizen_v516_contest_admin_actor` permite aos perfis originais `admin-semus` e `admin-cidadao` vinculados a município ativo e sessão/MFA válidas; `citizen_v516_contest_admin_queue` lista recursos restritos ao município.
- `citizen_v516_contest_admin_review` decide `ACOLHIDA` ou `NÃO ACOLHIDA` com texto 5–2000 caracteres, hora, ator e UUID de requisição; uma decisão já tomada não pode ser sobrescrita por outro administrador; replay idêntico é seguro.
- **Nenhuma punição automática**: registrar ou analisar sinalização, apresentar/decidir contestação não altera status ou conta `citizen_v516_accounts.moderation_status`, protocolo SEMUS, tarifa, acesso ao estacionamento ou documento TTS.
- As funções `SECURITY DEFINER` concedem `EXECUTE` à role HTTP, sem SELECT nas tabelas com PII; app de scanner/reconciliador não tem acesso.

## Limites e próximos trabalhos

**Não é jornada operacional ainda**: funções não expostas por HTTP nem ligadas aos aplicativos React Native/ADM. Evidência opcional de foto/arquivo prevista no HTML ainda não foi conectada à cadeia privada de upload/normalização/antivírus; NÃO aceitar data URL em texto ou abrir download irrestrito. O HTML também permite novas contestações após estados legados `RECUSADA/ARQUIVADA`, que não existem neste fluxo novo: antes de reenvio ou reabertura é necessária uma modelagem explicitamente auditada contra a referência.

A autenticação de visitante remota continua bloqueada pela ausência de titularidade segura no servidor; não inventar campo adicional. Regras de retenção LGPD, bloqueio/rate limit e logging de consulta ao recurso devem ser aprovadas antes da exposição pública.

**Testes**: PostgreSQL 17 real, mesmas migrações V5.16 001–010 e 020–028, dois cidadãos autenticados diferentes, acesso de guarda vs. ADM SEMUS/ADM Cidadão, idempotência, não alteração do protocolo/conta, decisões justificadas e sem SELECT direto. Testes anteriores de Guada/plantão/suporte/sinalização preservados integralmente, exceto correção de expectativa dos estágios distintos comprovados da mesma denúncia.

Branch DRAFT empilhada na PR #47, sem deploy, merge, `main`, VPS ou alterações no protótipo.
