# MATRIZ DE PARIDADE V5.16 — Cidadão → Guarda → ADM SEMUS

**Fonte primária:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`
**SHA-256 confirmado:** `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`.
**Situação:** especificação extraída diretamente do HTML V5.16; **não autoriza merge ou implantação** sem implementação/ensaios posteriores.

## 1. Cadastro de denúncia de Trânsito (App Cidadão)

**Fonte:** `cidadao-ai/index.html`, tela `trafficForm` (~655–709), `submitTrafficForm()` (~1460–1465).

| Entrada | ID/fonte HTML | Obrigatoriedade / comportamento |
|---|---|---|
| Tipo de ocorrência | `trafficType` | Obrigatório, com opções originais: estacionamento irregular, bloqueando acesso/garagem, área proibida, via parcialmente bloqueada, circulação irregular, transporte irregular, outro problema de trânsito |
| Local da ocorrência | `trafficLocation` | Obrigatório, texto de local ou referência |
| Placa do veículo | `trafficPlate` | Opcional |
| Descrição | `trafficDescription` | Obrigatória |
| Foto | `trafficCameraInput`, `trafficGalleryInput`, `appState.trafficPhoto` | **Obrigatória antes do envio**, com câmera ou galeria e prévia |
| Identificação do denunciante | `trafficIdentityBox`, `readFormIdentity` | Obrigatória; vinculada à denúncia |
| Criar registro | `submitTrafficForm()`, `persistCitizenProtocol()` | **Um único protocolo canônico**; `category: "Trânsito (SEMUS)"`, `destination: "SEMUS / Guarda de trânsito"`, `status: "RECEBIDA"`; ID de protocolo visível e posterior acompanhamento |

**Invariante:** um registro sem foto, identidade, local, tipo ou descrição não pode ser encaminhado como denúncia de trânsito concluída. Uma solicitação genérica `denuncia/title/description` sem esses dados não substitui essa tela.

## 2. Guarda / SEMUS — fila e atendimento do MESMO protocolo

**Fonte:** `guarda-semus/index.html`, script `jfGuardOperational`, ~489–519.

| Operação | JS HTML original | Semântica que a API deverá preservar |
|---|---|---|
| Montar fila | `allTraffic()`, `renderQueues()` | Usar `jeriFlowCitizenProtocolsV2` (protocolo canônico), filtrar categoria/destino Trânsito/SEMUS; agrupar novas, em atendimento e finalizadas pelo status do protocolo |
| Detalhar | `findProtocol(id)`, `openDetail(id)` | Mostrar mesmo ID da denúncia, cidadão, local, placa opcional, data, descrição, prioridade/evidência |
| Assumir | `acceptReport(id)` | Atualiza **mesmo registro** para `EM ATENDIMENTO`, com `acceptedAt` e `assignedGuard`; emite atualização |
| Atendimento | `openService(id)` | Exibir responsável, histórico/sinalizações e campos de resultado |
| Finalização | `finishBtn` | Status `FINALIZADA`, `serviceResult`, `serviceAction`, `serviceNote`, `finishedAt`, `finishedBy`; atualização imediata à central |
| Apoio | `supportModal`, `supportSend` | Solicitação de apoio vinculada ao ID do protocolo; não criar ocorrência paralela |
| Reporte de denunciante | `reportCitizenModal`, `reportCitizenSend` | Registra `citizenFlag` com motivo, observação, data e agente; **não pune automaticamente** o cidadão |
| Plantão | `shiftBtn`, `publishGuardState` | Estado de plantão separado dos dados canônicos dos protocolos; não usar o estado de plantão como base principal das ocorrências |

**Invariante:** o guarda nunca cria uma segunda ocorrência desvinculada como substituta da denúncia do Cidadão. A integração segura com banco pode representar o protocolo como registro transacional e manter log de eventos; os campos/status públicos seguem a V5.16.

## 3. ADM SEMUS — acompanhamento, correção e sinalizações

**Fonte:** `admin-semus/index.html`, funções `renderOccurrences()` (~137), `openOccurrence()` (~157), `reopen()` (~172), `closeAdmin()` (~178), `reviewFlag()` (~184).

| Área | Correspondência exigida |
|---|---|
| Fila de trânsito | Ler os **mesmos protocolos** do App Cidadão/Guarda, inclusive `location`, `plate`, cidadão, status e datas |
| Histórico | Listar ocorrências finalizadas com resultado de campo, providência, agente e data |
| Equipe | Contas e estado do plantão do App Guarda, separados da fonte dos protocolos |
| Observação administrativa | Alterar nota SEMUS vinculada ao protocolo existente |
| Reabrir ocorrência | `REABERTA` no histórico administrativo; retornar status para `RECEBIDA`, desfazer atribuição ativa, preservar histórico |
| Encerrar administrativamente | Justificativa obrigatória informada pelo operador; status `FINALIZADA`; registrar motivo, data e agente |
| Sinalizações | Visualizar `citizenFlag` e analisar/arquivar administrativamente; nenhum bloqueio/punição automática do cidadão |

## 4. ADM Cidadão — separação da competência da Guarda

**Fonte:** `admin-cidadao/index.html`, `isTraffic()` (~116), `openProtocol()` (~173–199).

- O ADM Cidadão acompanha demandas de Trânsito/SEMUS e pode registrar observação administrativa.
- Para Trânsito, a própria tela informa que status operacional é controlado pela Guarda/SEMUS. **Não** substituir o fluxo de campo por botões genéricos de Ouvidoria.
- Outros destinos/categorias têm administração própria, que deverá ser extraída da V5.16 em matrizes subsequentes.

## 5. Comunicação da atualização

**Fonte:** `GUIA_PARA_PROGRAMADORES.md`, seções **Fonte única de dados / SEMUS em tempo real / Notificações**, `shared/jeriflow-data.js`, `shared/jeriflow-inbox.js`.

- Fonte canônica dos protocolos: `jeriFlowCitizenProtocolsV2`; na versão reescrita, expor o mesmo conceito por uma única API/entidade, nunca snapshots isolados.
- Eventos originais principais: `citizen.protocol.updated`, `guard.incident.accepted`, `guard.incident.finished` e casos de correção administrativa (reabertura e finalização).
- Contagens de SEMUS devem ser derivadas da situação real de protocolos; nenhuma fila independente `app.guarda_occurrences` pode ser a fonte principal.

## 6. Cenários mínimos de aceitação (antes de qualquer merge)

1. Cidadão tenta denúncia de trânsito **sem foto** → envio recusado; sem protocolo fictício de trânsito.
2. Cidadão tenta sem tipo, local, descrição ou identificação → validações correspondentes da tela são aplicadas.
3. Cidadão envia denúncia válida com foto → aparece em seus protocolos, Guarda, ADM SEMUS e ADM Cidadão com **mesmo ID**.
4. Guarda autorizado assume → status `EM ATENDIMENTO`; atualização para todas as telas relevantes e atribuição do agente.
5. Guarda conclui com situação/providência/observação → `FINALIZADA`, histórico de campo visível.
6. Agente sinaliza denunciante → indicador `citizenFlag` disponível para análise, sem punição automática.
7. ADM SEMUS reabre → volta à fila como `RECEBIDA`, com histórico de reabertura, sem apagar o atendimento anterior.
8. ADM SEMUS encerra administrativamente com motivo → status final e justificativa auditada; sem duplicar ocorrência.
9. ADM Cidadão acompanha trânsito sem assumir nem finalizar atendimento de campo por fluxo genérico.
10. Usuário de outro município ou perfil não autorizado não pode assumir, alterar ou consultar dados indevidos.
11. Perda de rede, duplicação e concorrência não produzem dois protocolos ou duas aceitações silenciosas; as proteções técnicas devem preservar a UX original.
12. Fluxo rodando em servidor de homologação exclusivo JeriFlow e Android/iOS reais somente após ambiente/identidade aprovados; bundle verde não equivale a aceite.

## 7. Restrições de escopo

Sem gateway/PSP, sem integração financeira, sem nova central de atendimento genérica, sem formulário paralelo de Guarda ou reinterpretação de status, sem editor de retenção/arquivamento extra, sem alterar `main`/produção antes de provas e autorização.

**Origem:** exclusivamente a V5.16. Esta matriz é documentação de paridade, **não** software funcional pronto.
