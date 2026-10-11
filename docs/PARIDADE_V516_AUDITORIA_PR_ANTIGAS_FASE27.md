# JeriFlow V5.16 — Etapa 27: conciliação SEGURA das branches históricas

**Regra suprema:** o ZIP original `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` foi conferido ANTES de criar esta etapa. SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, `unzip -t` sem erros; original `cidadao-ai/index.html` `#trafficForm` e `guarda-semus/index.html` `renderQueues`, `acceptReport`, `finishBtn`, assim como `admin-turismo/index.html` `saveReg` / `saveExtension` / `registerManualExit`.

## Fontes históricas realmente inspecionadas

- PR #9, `feature/turismo-estacionamento-solicitacoes-20261010`, commit fixado **`df68fe09b9e5e8ee689cc2f84511bbbcd29ee1e3`**. Ela incorpora a cadeia de Ouvidoria/Guarda antiga #5–#8. PRs #5–#8 estão explicitamente intituladas *BLOQUEADA — NÃO É PARIDADE V5.16*; PR #9 *FORA DA V5.16 — FECHADA*. **Não considerá-las parte automaticamente aprovada do produto.**
- Linha V5.16 em desenvolvimento, até a PR #41, commit-base `402b5e099d9c36ae9875582e4c38f57479d72838`. As migrações atuais 001–010 e 020–022 foram testadas juntas em PostgreSQL na PR #41, mas isso NÃO inclui a cadeia antiga.

## Matriz de incompatibilidade confirmada

| Faixa | Legado PR #9 | V5.16 PR #41 | Decisão |
| --- | --- | --- | --- |
| 001–003 | Identidade/autenticação | Os MESMOS bytes e SHA dos arquivos históricos | **Preservar sem reexecutar/substituir** |
| 004–010 | Ouvidoria, arquivos, scanner e administração antigos | Cadastro Cidadão, foto Trânsito SEMUS, varredura e titularidade | **Colisão real de numeração; não mesclar por nome/número** |
| 011–016 | Avisos/retencão de Ouvidoria e Guarda históricos | Ausentes na linha atual | **Quarentena para auditoria de conformidade V5.16, sem promoção** |
| 017 | `parking_service_requests`: fila de pedidos de serviço, sem diárias, valor, comprovante ou autorização | Ausente | **NÃO é o cadastro operacional de estacionamento V5.16** |
| 020–022 | Ausentes no legado | Registro real/diárias e saída, consulta ADM e chave criptografada de Turista | Preservar na linha V5.16 |

Também foi inspecionado `infra/migrations/012-guarda-occurrences.sql` antigo: introduz `app.guarda_occurrences` com `open/in_review/closed`, que NÃO é o protocolo único de Trânsito `JF-AAAAMMDD-NNNNNN` da V5.16 criado pelo Cidadão para a Guarda e SEMUS. Qualquer migração deve preservar **o protocolo canônico** e o modelo original de aceitação, atendimento, sinalização e conclusão; não basta copiar o painel antigo.

O arquivo antigo `infra/migrations/004-ouvidoria-protocols.sql` cria uma tabela genérica `app.ouvidoria_protocols` com `denuncia/reclamacao/solicitacao/sugestao`. O HTML original distingue manifestação da Ouvidoria administrativa e denúncia de trânsito obrigatoriamente fotografada. Os fluxos não devem ser confundidos.

## Proteção implementada, verificável e repetível

- `scripts/v516-legacy-compat-audit.mjs`: compara SOMENTE LEITURA as árvores de migrações de dois checkouts independentes, com SHA256 de cada SQL. Falha se 001–003 não forem idênticos, se surgir migração duplicada na mesma linha, se uma nova colisão de numeração for introduzida sem revisão, se 012/017 históricos forem trocados ou se alguém tratar a fila antiga como estacionamento canônico.
- `tests/v516-legacy-compat-audit.test.mjs`: ensaia casos sintéticos de colisão nova, alteração de identidade, substituição de arquivo histórico e ordinal duplicado.
- `.github/workflows/v516-legacy-compat-audit.yml`: faz checkout da linha atual e **do commit histórico imutável** `df68fe...` em pastas separadas, sem credenciais GitHub persistidas, e compara os ARQUIVOS REAIS. Gera relatório no runner; **NÃO executa nenhum SQL antigo, não copia código entre branches e não faz merge**.

## Critérios obrigatórios para integrar de verdade

1. Mapear cada função/painel antigo a um componente real da V5.16 e à regra correspondente da fonte HTML, e marcar divergências como bloqueadas.
2. Escolher modelo canônico sem duplicar o protocolo SEMUS, as sessões Cidadão ou as diárias/recebimentos do estacionamento. Não renomear um arquivo 004–017 para outro número e chamá-lo de compatível sem auditoria de dependências.
3. Criar migração de **ponte aditiva** apenas para componentes comprovadamente fiéis à V5.16, com testes PostgreSQL com dados sintéticos e validação de privilégios; nenhuma mutação destrutiva para converter modelos fora da referência.
4. Integrar UI e aplicativos SOMENTE após validação backend/SQL; assegurar consistência de status e permissões em Cidadão, Guarda, SEMUS e ADM Mestre.
5. Não habilitar em `main` ou VPS sem homologação da cadeia integrada e aprovação para produção. Esta auditoria está em PR DRAFT e não implica autorização para qualquer merge.

**Escopo:** a etapa 27 cria apenas auditoria/teste/workflow/documentação, SEM mudança em código de produto, schemas reais, HTML ou infraestrutura. Não conclui o trabalho de integração — torna verificável a exigência de **não sobrescrever nem inventar**.
