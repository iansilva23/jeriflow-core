# JeriFlow V5.16 — Fase 35: HTTP autenticado ATENDER / FINALIZAR da Guarda

**Referência SUPREMA antes de alterar:** reaberto ZIP original `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, verificado íntegro. `guarda-semus/index.html`: `acceptReport()`, `finishBtn`, os quatro `serviceResult`, os cinco `serviceAction` e `serviceNote`. Também relida `infra/migrations/024-citizen-v516-guard-service.sql` da PR #44 e HTTP GET criado na PR #49, evitando duplicar funções ou estados.

## O que foi acrescentado, exclusivamente por opção explícita

- Novo adaptador `guard-traffic-mutation-http-v516.ts` e serviço privado que apenas chamam duas funções SQL **já existentes e aprovadas**: `app.guard_v516_accept` e `app.guard_v516_finish`. Sem migração SQL, tabela paralela nem escrita direta da role HTTP. O mesmo protocolo `JF-...` de Cidadão/SEMUS é atualizado de `RECEBIDA` → `EM ATENDIMENTO` → `FINALIZADA`.
- `POST /api/v1/guarda/transito/JF-.../atender` recebe somente `{requestId}`. `POST /api/v1/guarda/transito/JF-.../finalizar` recebe somente `{requestId,result,action,note}`; recusa campos de papel/identidade arbitrários e opções fora da V5.16.
- Bearer de sessão canonical, UUID do município e request UUID, JSON compacto até 4096 bytes, conteúdo UTF-8 não comprimido, nenhuma sessão em URL ou cookie, no máximo quatro operações simultâneas por processo, erros PG sanitizados (`JF003=403`, `JF004=404`, `JF005=409`). O serviço do PostgreSQL revalida proprietário da sessão, vínculo municipal, perfil Guarda responsável, transição de estado e concorrência com `FOR UPDATE`.
- O quinto parâmetro opcional de `createApp` permite INJEÇÃO somente em testes/ambiente expressamente isolado. O `main.ts` continua chamando `createApp(probe,identity)`: **POST retorna 503 NOT_IMPLEMENTED no servidor normal**. Rota GET da PR #49, identidade e fotos privadas seguem sem alteração. O bloqueio de produção `NODE_ENV=production` continua intacto.
- Testes com serviço simulado verificam rejeição de login ausente, município falso, campos extras, ação inventada, corpo excessivo, saída SQL sem PII, permissão e concorrência. Teste HTTP com PostgreSQL 17 cria Cidadão, fotos fictícias exclusivamente de banco, novo protocolo, guarda autenticado, outro guarda e ADM SEMUS, faz POST Atender/Finalizar e verifica estado/histórico canônicos, duplicatas de requestId, negação de operador estranho e ausência de mudança sem autorização. Casos de scanner ClamAV real permanecem com os testes das PRs de fotos e não são alegados nesta etapa.

## Bloqueios necessários antes da operação real

- **Ainda NÃO foi conectado ao App Guarda RN** ou ADM SEMUS; `main.ts` não ativa as rotas. Sem rastreamento de atendimento, notificações reais à central, estado online confiável, suporte/flag/contest via HTTP, foto de conclusão ou homologação nos aparelhos.
- `serviceAction: Autuação realizada` é uma informação de registro preenchida pelo Guarda, **não emite autuação automática, multa ou cobrança**. Estacionamento e TTS independentes.
- Antes de qualquer produção, faltam controle distribuído de taxa/abuso, auditoria de acessos pessoais, retenção LGPD, observabilidade, reconciliação das PRs antigas e homologação conjunta da API/Apps.
- Nenhum merge, VPS, publicação ou alteração de visibilidade; PR empilhada DRAFT sobre #49.

**Base PR #49:** `2f5c2f2ef1c9919436f00c73aefa3c7c1187de30`.
