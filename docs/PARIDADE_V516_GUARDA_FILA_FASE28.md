# JeriFlow V5.16 — Etapa 28: Guarda/SEMUS consultam a fila do protocolo canônico

**Regra suprema consultada antes dos commits:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` conferido (SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, ZIP íntegro). Os fluxos `cidadao-ai/index.html` `submitTrafficForm()` e `guarda-semus/index.html` `renderQueues()`, `openDetail()`, `openService()`, `acceptReport()`, `finishBtn` são referência única. O ADM SEMUS consome os MESMOS protocolos; não deve existir uma nova tabela `guarda_occurrences` para reproduzir pedidos do cidadão.

## Auditoria de preservação

A auditoria técnica da PR #42 fixou o commit legado `df68fe09b9e5e8ee689cc2f84511bbbcd29ee1e3` e bloqueou automaticamente colisões 004–010, identificando a tabela paralela `app.guarda_occurrences` histórica como modelo diferente. Antes de criar esta etapa verificou-se a existência dos arquivos de destino: NÃO havia migração 023, teste ou workflow da fila; todos foram ADICIONADOS, nenhum conteúdo preexistente substituído.

## Entrega

- Nova migração `023-citizen-v516-guard-queue.sql`, com funções `citizen_v516_guard_queue` e `citizen_v516_guard_detail`. É somente leitura, **sem nova tabela de ocorrências** e sem alterar os estados V5.16 `RECEBIDA`, `EM ATENDIMENTO`, `FINALIZADA` nem o protocolo `JF-AAAAMMDD-NNNNNN`.
- O backend autentica sessões de `guarda` ou `admin-semus` verificadas no esquema de identidade e a associação ativa ao município; perfil `turista`, falta de permissão, logout e prefeitura diferente não têm acesso.
- A lista retorna SOMENTE protocolo, descrição, localização, placa, status e a informação se a foto existe, sem informações pessoais, UUID/arquivo/hash da fotografia ou URL pública. Os detalhes contêm nome e telefone do denunciante só depois de autorização (sem bytes/imagem pública).
- Filtros internos `NEW`, `IN_SERVICE`, `FINISHED` referenciam os status originais, NÃO criam um fluxo de produto distinto. Paginação limitante de 50 para impedir consultas excessivas.
- A API tem somente EXECUTE em funções estreitas. Não recebe SELECT na tabela privada do Cidadão; papel de scanner nem reconciliador podem chamar as consultas da Guarda.
- Testes PostgreSQL 17 em runner isolado aplicam **toda a sequência da linha V5.16 001–010, 020–023**, criam dados falsos de Cidadão/Guarda/SEMUS/Município vizinho e três protocolos canônicos, validam isolamento de PII, acesso, status, paginação, revogação e ausência de modelo paralelo. A mídia do teste é um fixture de banco e **não representa uma nova prova de ClamAV**; provas reais do scanner já existem em CI de outras PRs.

## O que NÃO está concluído

O protocolo ainda não é recebido por uma rota pública de Guarda; as telas RN e ADM SEMUS não estão integradas. Os comandos de aceitar denúncia, iniciar atendimento, pedir apoio, acompanhar localização, sinalizar abuso e finalizar devem ser implementados em migração aditiva POSTERIOR, com validação de estado/transação, autorização e auditoria. O atendimento não pode ser concluído por API sem a Guarda real autenticada.

Os uploads, fotos privadas, a identificação segura de visitante, observabilidade, LGPD, testes em celulares físicos e a implantação de produção seguem pendentes. **Nenhum merge, migração de banco real, deployment VPS ou HTML alterado.** A linha antiga #5–#9 permanece fora de paridade até revisão de cada comportamento, não importa que o SQL isoladamente fosse executável.

**Base:** PR #42 `25d6d2f6951ff94877f36e39f8831b5ee9d3d2bd`. PR empilhada DRAFT.
