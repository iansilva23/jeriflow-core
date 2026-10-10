# JeriFlow V5.16 — Fase 19: idempotência persistente e inventário seguro de órfãos

## Referência obrigatória, antes de programar

ZIP original \`JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip\`, SHA-256 \`89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad\`; \`unzip -t\` OK. Conferidos novamente \`cidadao-ai/index.html\` (formulário \`#trafficForm\`, \`submitTrafficForm()\`, campos, câmera/galeria) e \`shared/jeriflow-audit-citizen.js\` (\`evidence()\`, \`submitTrafficForm()\`). O HTML original não especifica status extras, campo de chave idempotente nem nova denúncia da Guarda/SEMUS. Esses elementos **não são adicionados**.

## Objetivo

A fase 18 já encadeia formulário aprovado, fotografia higienizada/antimalware e \`app.citizen_v516_traffic_submit()\` (o mesmo protocolo \`RECEBIDA\` visto pela Guarda/SEMUS). A recuperação de ACK isolada da fase 18 só resolve falhas após COMMIT com UUID/SHA da foto já conhecido no processo. Em caso de repetição do próprio envio após travamento do processo, a fase 18 pode criar OUTRA fotografia antes de descobrir que a primeira tentativa foi concluída.

## Entrega técnica

1. **Migração 009:** tabela privada \`app.citizen_v516_traffic_attempts\`, vinculada a conta real, município e SHA-256 de conteúdo. Os estados \`PROCESSING\`, \`PHOTO_READY\` e \`COMPLETE\` são ESTADOS INTERNOS de banco, jamais status do Cidadão, Guarda ou SEMUS. \`jeriflow_app\` e o scanner não recebem SELECT/INSERT/UPDATE na tabela.
2. **Digest calculado no servidor** a partir dos campos originais normalizados (título, local, placa, descrição) e SHA-256 dos **bytes originais** da fotografia. A tabela separa tentativas por conta e município. Não exige campo novo na interface, nem \`photoId\`, \`citizenId\` ou idempotency-key enviados pelo dispositivo.
3. **Começar:** \`citizen_v516_traffic_attempt_begin()\` revalida a sessão, bloqueia a mesma requisição concorrente via \`BUSY\` e lease de 5 minutos, devolve \`PHOTO_READY\` após uma falha retomável e \`COMPLETE\` com o número canônico gravado para repetições dentro de 24 horas. Passadas 24 horas da conclusão, o mesmo formulário pode originar outra ocorrência legítima. Na troca de dia, não muda a regra de deduplicação.
4. **Após o scanner:** \`citizen_v516_traffic_attempt_photo_ready()\` exige o lease, conta, reserva de titularidade e registro de varredura assinada no gate do worker com SHA e município iguais, e mantém o ticket privado apenas em PostgreSQL.
5. **Publicação do protocolo:** \`citizen_v516_traffic_submit_once()\` exige que a foto já esteja elegível e chama a função **original** \`citizen_v516_traffic_submit()\` (migração 005), com trigger de proprietário (007); marca tentativa \`COMPLETE\` na **mesma transação** PostgreSQL. Se o commit for concluído e o ACK se perder, uma nova chamada de \`begin\` recupera o mesmo protocolo sem novo scan ou segundo insert. O mecanismo privado de confirmação da migração 008 continua disponível.
6. **Diagnóstico conservador:** \`citizen_v516_traffic_orphan_counts()\` apresenta três contagens agregadas de tentativas com lease expirado há mais de 24 h, reservas sem protocolo e fotos elegíveis não consumidas. A função não divulga PII nem apaga arquivos/linhas e NÃO é concedida à API HTTP. **Não alegar limpeza automatizada implementada.**

## Limites intencionais e bloqueios

- É uma **deduplicação técnica com janela de 24 horas**. Dois pedidos realmente idênticos da mesma conta, com mesmos bytes e campos, dentro dessa janela retornam o mesmo número; a janela reduz repetição acidental, sem permitir bloqueio vitalício de um novo chamado legítimo.
- A execução que exceder o lease de 5 minutos pode disputar reprocessamento após expiração. Isso não duplica o protocolo final em uma única tentativa, mas pode deixar arquivo/snapshot órfão privado se o worker original ainda continuar. **Pendente:** heartbeat de lease, limite distribuído, reconciliação.
- Queda do processo **após criar foto/gate e antes de \`photo_ready\`** pode deixar uma mídia reservada órfã. A contagem identifica problemas; a remoção destrutiva só deve acontecer após implementar um reconciliador que bloqueie transações de protocolo e garanta consistência entre PostgreSQL e sistema de arquivos. Não apagar mídia antes do COMMIT sem garantia de restauração.
- **Ainda não existe** endpoint real do formulário completo nem operação de upload/denúncia conectada aos apps; \`main.ts\` segue sem injetar as dependências, rota fotográfica da PR #30 responde 503 por padrão.
- **Visitantes:** continuam na UI V5.16, mas o \`deviceId\` local não prova identidade/posse da mídia num backend remoto; não desbloquear visitante sem vínculo confiável. Não adicionar campo de UX para resolver uma conveniência técnica.
- Necessários antes de deploy: reconciliação segura, antiabuso/quotas distribuídos, gestão LGPD, observabilidade, auditoria de dependências (npm em CI sinalizou vulnerabilidades, não auditadas aqui), backup/restauração, scanner oficial persistente, homologação física RN/Guarda/SEMUS.

## Segurança operacional

Migrar 009 APENAS em banco de testes até validação completa. Testes executam PostgreSQL 17 e daemon ClamAV reais no runner descartável; assinatura HDB sintética inofensiva, sem baixar assinaturas oficiais repetidamente. A fase 14 documenta o teste de bases OFICIAIS num runner distinto. Nenhum segredo, dado cidadão real, VPS, produção, pagamento, Ramo Nessa, HTML ou \`main\` é modificado.

**Base:** PR #33 \`bdaa035078635fc88cef8332f5519f5982a20fe5\`. Etapa 19 empilhada em PR DRAFT.
