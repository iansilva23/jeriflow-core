# Entrega controlada — JeriFlow Ouvidoria e Guarda

Branch: `feature/jeriflow-avisos-retencao-guarda-20261009`. Testes somente com dados fictícios.

## Bloco 1 — ADM

A regressão do commit `3375159` passou integralmente no PostgreSQL e Chromium. O papel `admin-cidadao` mantém consulta, tratamento e auditoria de **todas** as categorias do próprio município, incluindo denúncias. MFA e revogação continuam obrigatórios.

## Bloco 2 — Notificações internas

A migração 011 grava apenas identificadores, categoria de evento e data. A cada evento de Ouvidoria o autor recebe um aviso; ao criar/contestar, a equipe `admin-cidadao` ativa do mesmo município recebe aviso de demanda. O conteúdo do protocolo **não** é enviado ao feed. Consulta e confirmação de leitura revalidam conta, município e papel ativo; a revogação retira acesso imediatamente. O app Cidadão e o painel de Ouvidoria têm interfaces de avisos e botão de atualização. Essas notificações **não são push, SMS, email ou WhatsApp**; dependerão de provedor homologado e consentimentos/legitimidade.

## Bloco 3 — Proteção e retenção

Todos os protocolos novos e anteriores são marcados com `legal_hold=true` e `awaiting_policy`. O administrador autorizado pode consultar a proteção; a operação fica em auditoria. **Não existe endpoint nem worker de exclusão**: não foi escolhido prazo arbitrário para denúncias, que dependerá de aprovação e fundamentação institucional (base legal, prazos de defesa, normas locais, revisão LGPD e direitos de titulares). Anexos continuam cifrados e protegidos pelo ClamAV. Planejar retenção e descarte auditados somente após a política escrita e testes de restauração/expurgo.

## Bloco 4 — Primeira fatia operacional Guarda / SEMUS

- Agente `guarda` autorizado pode registrar ocorrências fictícias das categorias `ocorrencia`, `apoio`, `orientacao`, `outro`, com título e descrição controlados, request ID idempotente e lista limitada aos próprios registros.
- `admin-semus` do mesmo município acompanha a fila e muda `open -> in_review -> closed`, com revisão otimista e evento auditado. Não existe acesso cruzado entre municípios.
- App Guarda e Admin SEMUS possuem telas iniciais conectadas à API autenticada e ao banco. **Não** há geolocalização real, comunicação por rádio, despacho de equipe, despacho de emergência, fotos, viaturas nem integração policial/municipal. Essa primeira fatia não deve ser utilizada para ocorrências reais ou emergências.

## Limitações de entrega

A regressão faz build/bundle Android+iOS, **não instalação em aparelho físico**. Não houve VPS exclusivo, credenciais de produção, notificações push externas, publicação nas lojas, política LGPD homologada ou go-live. A prontidão `/health/ready` permanece 503 por projeto. `main` preservada até revisão da PR. Os registros de log não incluem conteúdo de denúncias, fotos ou nomes.
