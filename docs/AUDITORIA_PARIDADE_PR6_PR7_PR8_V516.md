# Auditoria de paridade V5.16 — PRs #6, #7 e #8

**Data:** 10/10/2026
**Estado:** escopo divergente CONFIRMADO e BLOQUEADO, sem alterações em `main` nem descarte dos commits antigos.

## Referência primária inspecionada antes desta decisão

- Pacote original: `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`
- SHA-256 recalculado neste trabalho: `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`
- Arquivos examinados diretamente: `GUIA_PARA_PROGRAMADORES.md`, `guarda-semus/index.html`, `admin-semus/index.html`, `admin-cidadao/index.html`, `cidadao-ai/index.html`, `shared/jeriflow-data.js`, `shared/jeriflow-inbox.js`.

## Divergência confirmada 1 — a fonte e o fluxo da Guarda / SEMUS

**V5.16 — fonte e ações:**
- `GUIA_PARA_PROGRAMADORES.md`, seção **SEMUS em tempo real — regra da V4.7**: a fonte oficial é `jeriFlowCitizenProtocolsV2`; `jeriFlowGuardStateV2` não pode ser a fonte principal dos números.
- `guarda-semus/index.html`, JS `allTraffic()` (linha ~492): filtra diretamente os protocolos do Cidadão por categoria/destino Trânsito/SEMUS.
- `guarda-semus/index.html`, `acceptReport(id)` (~512): assume **um protocolo do Cidadão existente** e altera o status desse mesmo registro para `EM ATENDIMENTO`.
- `guarda-semus/index.html`, fluxo `serviceResult`, `serviceAction`, `serviceNote` (~458–465): fecha o atendimento registrando a situação encontrada, providência e observação; há ainda pedido de apoio e sinalização para análise administrativa.
- `admin-semus/index.html`, `renderOccurrences()` e `traffic()` (~137–142): lista protocolos oficiais; `reopen(id)` e `closeAdmin(id)` (~172–183) reabrem/encerram esses protocolos com histórico, sem criar uma fila paralela.
- `cidadao-ai/index.html`, `submitTraffic` (~1464): o protocolo de trânsito parte do App Cidadão.

**Implementações divergentes (PRs #6–#8):**
- PR #6: migração `infra/migrations/013-guarda-occurrences.sql` e app de criação de ocorrência independente.
- PR #7: migração `infra/migrations/012-guarda-occurrences.sql`, tabela `app.guarda_occurrences` com fluxo próprio `create → review → close`.
- PR #8 herda esse modelo; `packages/mobile-auth/GuardOccurrences.tsx` abre formulário para uma **nova** ocorrência com tipo/título/descrição/local, enquanto `apps/admin/app/paineis/semus/ocorrencias/panel.tsx` recebe `review/close` da tabela separada.
- O modelo diverge da origem Cidadão e deixa de reproduzir `acceptReport`, providência de campo, sinalizações do denunciante e reabertura administrativa do **mesmo protocolo**.
- Portanto não é aceitável homologar ou mesclar esse fluxo como substituto da V5.16. Corrigir exige reaproveitar o protocolo do Cidadão e seus eventos, não criar outra fonte de verdade.

## Divergência confirmada 2 — interface de governança/retenção

**V5.16:** `admin-cidadao/index.html` apresenta visão geral, triagem, protocolos, sinalizações e cidadãos; o JS `openProtocol` (~173–199) edita status/destino administrativo e observações dos protocolos, respeitando leitura somente administrativa para trânsito. Não foram encontradas nesse módulo telas para configurar `retentionDays` nem para arquivar/desarquivar protocolos como operação separada.

**Código da PR #8:** `infra/migrations/014-ouvidoria-governance.sql` adiciona `app.ouvidoria_retention_drafts` e `app.ouvidoria_archive_state`; `apps/admin/app/paineis/cidadao/ouvidoria/panel.tsx` expõe formulário de prazos entre 1 e 36500 dias, `/ouvidoria/retention/draft`, e botões para `/ouvidoria/retention/archive` ou desarquivamento.

**Decisão:** retirar esses **controles visíveis adicionais** da cadeia ativa. Não confundir essa retirada com abandono da segurança/LGPD: proteção interna, integridade, trilha e controles necessários podem existir desde que não alterem as operações funcionais da V5.16. Questões jurídicas de prazo exigem decisão própria antes de qualquer exclusão.

## Partes que NÃO devem ser apagadas sem auditoria

- Ouvidoria e protocolo do Cidadão com segurança, anexos e histórico (partes já existentes e testadas na PR #5/#7).
- Avisos da Ouvidoria e controle de leitura; `GUIA_PARA_PROGRAMADORES.md`, seção **Central de Notificações — V4.8 e V4.9**, comprova que central de notificações e histórico existem na V5.16.
- Aperfeiçoamentos técnicos internos de autenticação, proteção contra dados maliciosos, auditoria, SQL e isolamento municipal, quando não introduzirem funcionalidades divergentes.
- É necessário conferir sua **paridade integral**; testes de compilação/integração **não** comprovam correspondência funcional.

## Ação imediata e plano permitido

1. **Retirar PRs #6, #7 e #8 da cadeia de integração** devido aos fluxos divergentes, sem apagar seus commits nem mesclá-los. Registrar SHA original em cada PR e preservá-la para resgate seletivo.
2. PR #5 continua DRAFT, com Ouvidoria, proteção e scanner; precisa ser auditada frente aos formulários de Cidadão e ADM Cidadão da V5.16 antes de qualquer merge.
3. A reconstrução da Guarda deverá usar a **mesma entidade de protocolo** criada pelo Cidadão (e não `app.guarda_occurrences` independente), com estados, transições, resultados de campo, reabertura e histórico conforme HTML.
4. Notificações globais deverão seguir os públicos e eventos `shared/jeriflow-inbox.js`/guia original. Nada de novos canais externos sem evidência no HTML.
5. Não implementar nenhuma outra funcionalidade antes de verificar ZIP, função, campos, papéis, estados e critérios de teste da V5.16.

**PROIBIDO:** integrar PR #6, #7 ou #8 ou implementar governança administrativa extra antes de um novo mapeamento fiel. Sem merge automático, sem produção e sem utilização da VPS do Ramo Nessa.
