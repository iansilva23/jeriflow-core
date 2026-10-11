# JeriFlow V5.16 — Fase 34: leitura HTTP privada da Guarda e ADM SEMUS

## Regra suprema — verificar antes de modificar

Em 11/10/2026 foi reaberto e conferido o ZIP V5.16 original (`JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, `unzip -t` sem falhas). Revisitados `guarda-semus/index.html` `renderQueues/openDetail` e `admin-semus/index.html`, mais o protocolo Cidadão V5.16 do HTML. Na ponta da PR #48 foram inspecionados `apps/api/src/server.ts`, `main.ts`, `identity-primitives.ts`, migração 023 e `tests/integration/traffic-guard-queue-v516.test.mjs`. Novo arquivo de adaptador e testes verificados como AUSENTES. Nenhuma regra da V5.16 foi recriada com novo estado ou serviço.

## O que a implementação realmente faz

- `GuardTrafficReadServiceV516` consulta **exclusivamente** as funções privilegiadas `app.citizen_v516_guard_queue` e `app.citizen_v516_guard_detail` da migração 023, sem SELECT direto em tabelas de dados pessoais. A sessão do usuário é convertida em SHA-256, preservando autorização PG real: Guarda ou ADM SEMUS, município ativo, sessão/MFA, sem permissão para outros perfis. Chave no header `Authorization: Bearer` e município validado a partir de `x-jeriflow-municipality-id`; papéis/identidades de usuário enviados arbitrariamente não contam.
- Novo adaptador HTTP SOMENTE leitura: `GET /api/v1/guarda/transito?filter=ALL|NEW|IN_SERVICE|FINISHED&after=JF-...&limit=20` e `GET /api/v1/guarda/transito/JF-...`. Filtros são parâmetros técnicos para as filas `RECEBIDA`, `EM ATENDIMENTO`, `FINALIZADA`, nunca novos estados de produto.
- Respostas de lista não trazem nome/telefone do denunciante, ID de imagem, URL ou bytes privados. Detalhes trazem PII apenas depois da verificação de autorização pelo PostgreSQL, como o HTML original prevê.
- Limites: tamanho/parâmetros de URL, no máximo 50 por página, método GET, nenhum corpo, oito solicitações simultâneas, erros SQL sanitizados, headers no-store/nosniff/no-referrer, nenhuma configuração CORS aberta ou cookies.
- **Opt-in obrigatório via injeção:** a assinatura de `createApp` ganhou um 4º argumento opcional de leitura da Guarda. `apps/api/src/main.ts` **NÃO** foi modificado e segue chamando `createApp(probe,identity)`; assim, qualquer requisição à rota sem serviço retorna `503 NOT_IMPLEMENTED`. O bloqueio de produção `NODE_ENV === 'production'` também permanece intacto. `POST` para assumir, finalizar, suporte, sinalizar e contestar continuam `NOT_IMPLEMENTED` e nenhuma mutação foi habilitada.
- Testes de segurança HTTP com serviço simulado incluem desconectado/opt-in, falta de token, verbos, query duplicada, estresse de 8 sessões simultâneas, vazamento de erros e método desconhecido. **Teste adicional de integração usa HTTP real ligado ao PostgreSQL 17 descartável**, com usuários Cidadão/Guarda/ADM SEMUS/Turista fictícios e protocolo canônico; valida permissões, filtro, detalhe, privacidade, revogação e status.

## Limitações que impedem implantação

- A implementação **NÃO habilita interface operacional**. O app Guarda React Native continua `AuthApp`, e o ADM SEMUS ainda não consome a rota. Não alegar aplicativo concluído.
- Não há throttle distribuído antiabuso por IP/sessão ou telemetria LGPD/observabilidade de acessos a PII. O limite simultâneo em memória é apenas a proteção inicial. Precisa adaptar o roteamento à segurança da infraestrutura homologada antes de qualquer produção.
- Não muda uploads, TTS, estacionamento, chat, pagamentos ou funcionamento do app da Guarda. Integração de `accept/finish/shift/support/flag/contest` exige rota autenticada própria, desenho de acesso e testes ponta a ponta.
- Todas as PRs #34–#48 são rascunhos empilhados; integrações antigas #5–#9 seguem auditadas para impedir colisões de migração. **NÃO fazer merge, deploy, migração no VPS ou alteração de visibilidade GitHub** nesta fase.

**Base:** PR #48 `f53983c182b443ef63404ffcd1ea68286bc2adaf`. Nova PR isolada DRAFT. 
