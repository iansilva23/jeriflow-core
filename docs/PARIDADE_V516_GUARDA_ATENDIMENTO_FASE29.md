# JeriFlow V5.16 — Etapa 29: assumir e finalizar atendimento da Guarda/SEMUS

## Regra suprema conferida ANTES de escrever

Arquivo original `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, `unzip -t` íntegro. A referência exata é `guarda-semus/index.html`:
- `acceptReport()` faz o protocolo original entrar em **EM ATENDIMENTO** e define o guarda responsável;
- `finishBtn` grava **FINALIZADA**, `serviceResult`, `serviceAction`, `serviceNote`, agente, horário;
- `serviceResult`: **Veículo encontrado**, **Veículo não encontrado**, **Situação já resolvida**, **Denúncia não confirmada**;
- `serviceAction`: **Orientação realizada**, **Autuação realizada**, **Veículo removido/direcionado**, **Solicitado apoio**, **Sem providência necessária**.
O `admin-semus/index.html` acompanha a mesma operação e preserva poderes próprios de fechamento/reabertura administrativos — **NÃO** atribuídos por conveniência à Guarda.

## Preservação obrigatória

PR #43 implementou fila e detalhes diretamente sobre `app.citizen_v516_traffic_protocols`. O arquivo de migração `023` e todo o histórico original foram consultados antes da etapa. Confirmou-se que `024-citizen-v516-guard-service.sql` e teste/workflow/documentação ainda NÃO existiam na branch. Foram adicionados novos arquivos, não substituídas funções, tabelas, HTML ou estado existente.

As migrações históricas das PRs #5–#9 (4–17) permanecem **bloqueadas pela PR #42** e não foram copiadas, alteradas ou executadas no novo banco. `guarda_occurrences` legado NÃO é a fonte do status da denúncia Cidadão.

## Implementação SQL interna

- A migração 024 cria **histórico privado de rodadas de atendimento** vinculado por FK ao protocolo canônico, sem criar um segundo número de ocorrência. Uma tentativa de reabertura autorizada futura preservará a rodada anterior; nenhum comando de reabrir foi ativado nesta etapa.
- `guard_v516_accept`: sessão atual + associação municipal ativa + papel de **guarda** exigidos no PostgreSQL, bloqueio `FOR UPDATE` do protocolo e transação indivisível (estado `RECEBIDA` -> `EM ATENDIMENTO`, agente responsável e evento de auditoria `ACCEPTED`). Solicitações concorrentes de outros guardas são recusadas.
- `guard_v516_finish`: exige o próprio agente que assumiu e protocolo `EM ATENDIMENTO`, opções de resultado/providência estritamente iguais às do HTML, nota de até 2000 caracteres e transação indivisível (resultado, ação, horário, evento `FINISHED` e estado `FINALIZADA`).
- `request_id` UUID único em cada comando: nova tentativa com ID antigo e mesmo agente não escreve outro evento. Reutilização do ID para outra ação/ocorrência/agente é recusada; a sessão continua sendo revalidada antes de devolver resposta.
- `guard_v516_service_history` retorna a Guarda e ADM SEMUS autorizados a linha temporal do protocolo, inclusive responsável, resultado, providência e nota de campo.
- `jeriflow_app` só recebe EXECUTE das funções, nunca CRUD direto das tabelas de história. Papel do scanner/reconciliador e usuários de outros municípios não recebem acesso.
- Não há evento de cobrança, multa real, documento de infração, imagem pública ou liberação de acesso a arquivos: `Autuação realizada` é **somente texto informativo escolhido pelo agente conforme a V5.16**, não execução de autuação oficial.

## Testes

PostgreSQL 17 real em runner descartável com credenciais distintas de dono e aplicativo, cadastros sintéticos de Cidadão, dois guardas, ADM SEMUS, Turista e agente de outro município. Executa a linha V5.16 001–010, 020–024. Valida: aceitar uma vez, reenviar, impedir outro guarda de assumir/finalizar, concorrência em duas conexões SQL, campos inválidos, finalizar, estado espelhado na fila Cidadão/SEMUS, preservação de foto e número canônico, histórico, sessão revogada e ausência de tabela paralela.

## Pendências honestas

**NÃO existe endpoint HTTP nem integração RN/ADM nesta etapa**, e os estados de plantão `onShift` do HTML ainda não estão autenticados no backend; a sessão de guarda é validada, mas presença em serviço precisa de mecanismo confiável antes de expor mutações ao app. As operações de solicitar apoio, sinalizar denunciante, reabrir e encerrar administrativamente (somente ADM SEMUS), foto protegida e notificações devem ser tratadas de acordo com o HTML em etapas posteriores.

Nenhum deploy, pagamento, TTS, merge, VPS, `main`, ou alteração do HTML original.
