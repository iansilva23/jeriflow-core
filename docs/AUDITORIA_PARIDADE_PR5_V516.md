# Auditoria de paridade V5.16 — PR #5 (Ouvidoria e cadastro do Cidadão)

**Data:** 10/10/2026. **Decisão:** DIVERGÊNCIA FUNCIONAL — NÃO MESCLAR COMO EQUIVALENTE.

## Fonte comprovada

ZIP original `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`
SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad` inspecionado diretamente.

### O HTML exige

`cidadao-ai/index.html`, linhas aproximadas **655–709**, tela `trafficForm`:
- Denúncia de Trânsito — SEMUS, com `trafficType` contendo tipos operacionais pré-definidos, `trafficLocation` obrigatório, `trafficPlate` opcional, `trafficDescription` obrigatório.
- Foto obrigatória (`trafficCameraInput`, `trafficGalleryInput`) antes de permitir o envio.
- Identificação do denunciante vinculada ao protocolo.
- `submitTrafficForm()` (~1460–1465) valida esses dados e cria **um protocolo canônico Cidadão**, categoria `Trânsito (SEMUS)`, destino `SEMUS / Guarda de trânsito`, status `RECEBIDA`. Esse protocolo alimenta diretamente Guarda e SEMUS.
- A V5.16 também contém outros fluxos especializados como sugestões e demandas de água/energia; não substituí-los por uma taxonomia genérica.

`admin-cidadao/index.html`, `isTraffic()` (~116), `openProtocol()` (~173–199):
- Acompanha ocorrências de trânsito **sem assumir a operação de campo**; as funções administrativas de situação/destino são diferentes conforme a categoria.
- Para outros protocolos, a gestão ocorre conforme destino, categoria e registros administrativos.

### O que a PR #5 implementou

- `apps/api/src/ouvidoria-input.ts` aceita apenas categorias genéricas `denuncia`, `reclamacao`, `solicitacao`, `sugestao`.
- `packages/mobile-auth/CitizenProtocols.tsx` cria um protocolo com `category/title/description`, sem o formulário específico para `Trânsito (SEMUS)`, sem local ou placa como campos correspondentes, sem obrigatoriedade de foto no momento do envio e sem destino `SEMUS / Guarda de trânsito` vinculado ao evento inicial.
- `packages/contracts/src/ouvidoria.ts` define estados genéricos `open/in_review/responded/contested/closed`, distintos da apresentação/ações operacionais do fluxo de trânsito do HTML.
- `apps/admin/app/paineis/cidadao/ouvidoria/panel.tsx` oferece fila genérica e ações de triagem/resposta/encerramento, sem distinguir suficientemente a tela original de trânsito somente acompanhada do atendimento SEMUS.

**Consequência:** essa PR contém infraestrutura técnica potencialmente aproveitável, mas NÃO implementa a jornada canônica da V5.16. Integrá-la como fluxo completo do Cidadão quebraria a equivalência funcional e a futura alimentação direta da Guarda.

### Componentes técnicos a preservar para reaproveitamento seletivo

- Persistência PostgreSQL, controles por município, auditoria, validação de entrada e autenticação.
- Proteção/varredura de anexos com quarentena e scanner, desde que esses mecanismos protejam o fluxo original sem mudar as condições de envio aceitas no HTML.
- Histórico de evento, se mapeado para os estados/destinos do HTML.
- Testes existentes: resultados aprovados de CI são evidência de engenharia, NÃO prova de paridade V5.16.

### Retomada correta (sem inventar)

1. Construir uma matriz por tipo de demanda do `cidadao-ai/index.html`, com campos, condições, identidade, status, destinos e anexos.
2. Restaurar como fonte de verdade o protocolo do Cidadão; Guarda/SEMUS operam o mesmo ID e sua trilha.
3. Definir migrações compatíveis e seguras somente após mapear totalmente a V5.16, sem inserir entidades ou estados visíveis adicionais.
4. Demonstrar teste E2E: denúncia de trânsito do Cidadão com foto → aparece no App Guarda → guarda assume/atende/finaliza → atualiza ADM SEMUS/ADM Cidadão, com o mesmo identificador.
5. Não ativar uso com cidadãos reais nem publicar apps até homologação institucional e LGPD.

**Decisão:** a PR #5 deverá sair da cadeia de integração, mas seus commits/branches devem ser preservados como fonte de componentes técnicos recuperáveis. NÃO executar remoção irreversível de arquivos e NÃO alterar `main`.
