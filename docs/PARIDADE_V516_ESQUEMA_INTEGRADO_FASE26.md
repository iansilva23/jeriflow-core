# JeriFlow V5.16 — Fase 26: compatibilidade técnica das migrações em uma base

## Não sobrescrever — regra suprema

O ZIP original `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad` permanece autoridade. Este documento resulta da conferência das 13 migrações presentes na ponta da PR #40 e da árvore de migrações antigas das PRs #5–#9. **Não sobrescrevemos nenhuma delas** e esta PR não altera esquemas, tabelas, endpoints ou páginas.

## O que este teste cobre

No MESMO PostgreSQL 17 descartável, com as credenciais separadas de proprietário e API, executar na ordem explícita:

- `001–003`: identidade, e-mail, MFA e contas do ADM;
- `004–010`: Cidadão, denúncia de trânsito/SEMUS, armazenamento e autorização de fotos;
- `020–022`: cadastro e diária do estacionamento, consulta ADM Turismo e chave protegida do Turista.

Depois da aplicação, criar contas fictícias nas duas famílias de autenticação, reservar foto fictícia de Cidadão sem forjar laudo ClamAV e registrar veículo fictício com pagamento já recebido manualmente no módulo Turismo. Confirmar que ações NÃO criam protocolos nem despesas entre módulos, que a API não faz SELECT direto de PII ou de chaves criptográficas, que papéis de scanner/reconciliação continuam segregados e que o município vizinho não recebe acesso.

Testes de foto real com ClamAV oficial, administração completa, vouchers impressos, TTS, PWA e aparelhos físicos foram feitos parcialmente em outras PRs ou estão pendentes — **este teste é de compatibilidade SQL/conta**.

## Limite crítico da integração

As migrações **004–017 das PRs antigas #5–#9 pertencem a OUTRA linha de desenvolvimento**, com nomes e números usados para Ouvidoria/Guarda. Este teste executa somente a linha V5.16 `004–010` atual e `020–022`. Passar nele NÃO significa que PRs antigas e novas já foram conciliadas ou que existe uma migração única pronta para `main`/VPS. A auditoria de colisões e a reconciliação sem perda de dados precisam ocorrer antes de qualquer merge, aproveitando as funcionalidades aprovadas de cada branch.

**Status:** PR DRAFT empilhada na #40; sem alteração da `main`, sem servidor e sem dados reais.
