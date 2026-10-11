# JeriFlow V5.16 — Fase 32: sinalização de denunciante SEM punição automática

## Verificação SUPREMA antes de implementar

ZIP `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, `unzip -t` íntegro. Foram lidos os originais `guarda-semus/index.html` (`reportCitizenModal`, `reportReason`, `reportReasonNote`, cinco motivos), `shared/jeriflow-audit-guarda.js` (exige descrição mínima **10 caracteres**, mídia opcional até 8 MiB, cria `citizenFlag.status='EM ANÁLISE'`) e `admin-semus/index.html` `reviewFlag` (decisões EXATAS `ARQUIVADA`/`ANALISADA`, `reviewStatus` inicial `PENDENTE`). Conferido também `shared/jeriflow-audit-citizen.js` (aviso visível ao cidadão e possibilidade de contestar).

Antes de editar, comparadas as migrações existentes 005, 023–026 e sua integração real do PostgreSQL; `027-citizen-v516-guard-flags.sql` não existia. A migração 027 é **nova e aditiva**, sem alterar tabela canônica `citizen_v516_traffic_protocols` ou arquivos originais. A suíte de testes foi ampliada depois da leitura do conteúdo anterior, sem remover cenários.

## Implementado

- Tabela privada `app.guard_v516_citizen_flags`, vinculada por chave estrangeira ao protocolo canônico do Cidadão; apenas UMA sinalização por protocolo, guard_user_id, município, motivo e nota (10–2000 chars). Motivos: `Trote / denúncia falsa`, `Informação deliberadamente incorreta`, `Uso abusivo do canal`, `Reincidência`, `Outro`.
- `app.guard_v516_flag_submit`: revalida sessão/perfil de GUARDA e município; exige agente assumindo a denúncia `EM ATENDIMENTO`. Mutex `FOR UPDATE` no protocolo, UUID de requisição para idempotência, sem alterar `RECEBIDA/EM ATENDIMENTO/FINALIZADA` nem criar novo protocolo. Retorna `status: 'EM ANÁLISE'` e `reviewStatus: 'PENDENTE'`.
- `app.guard_v516_flags_admin_queue`: lista para ADM SEMUS com role válida, página até 50 e dados mínimos (protocolo, nome denunciado, guarda, nota/motivo, resultado da análise), jamais fornecida ao papel Turista/Guarda sem privilégio.
- `app.guard_v516_flag_review`: SOMENTE ADM SEMUS com sessão válida escolhe `ARQUIVADA` ou `ANALISADA`; decisão idempotente e registrada com autor+hora. Revisar não executa suspensão, multa ou restrição; não há função que altere `app.citizen_v516_accounts` ou `app.citizen_v516_traffic_protocols`.
- Regras de segregação: `jeriflow_app` pode somente executar as funções estreitas, sem SELECT direto nas flags, enquanto scanner e reconciliador não recebem privilégios.

## Não confundir estágio técnico com jornada completa

**Evidência opcional:** o HTML permite anexar imagem até 8 MiB. Esta PR **NÃO** aceita nem armazena evidência em arquivo, pois ainda é necessária a cadeia privada de upload, antivírus, normalização e ownership para essas evidências específicas. Não declarar a sinalização completa na UI antes disso.
**Contestação:** o HTML permite ao Cidadão contestar a sinalização (mínimo 10 caracteres, arquivo opcional), e ao ADM SEMUS julgar `ACOLHIDA`/`NÃO ACOLHIDA` com justificativa. A implementação desse fluxo pertence à etapa seguinte; não criar punição automática nem apresentar decisão `ANALISADA` como sanção.
**Integração:** sem endpoint HTTP, apps React Native, atualizações de tela, notificação, publicação em produção ou homologação física. Não existe hoje decisão administrativa finalizada do cidadão, apenas relatório e revisão interna.

**Testes:** migrações 001–010, 020–027 no PostgreSQL 17 real; 5 novos testes de motivo/nota, guarda responsável e município, único relato por denúncia, fila SEMUS protegida, revisão auditada e ausência de bloqueio. Também são reaplicados os testes anteriores de plantão e solicitação de apoio e as regressões Cidadão.

**Estado:** PR DRAFT empilhada na #46, `main` e VPS intocados. Regra do usuário: NUNCA SOBRESCREVER algo já pronto, consultar fonte V5.16 e GitHub antes de qualquer ação.
