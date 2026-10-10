# JeriFlow V5.16 — Fase 9: protocolo canônico no PostgreSQL com foto verificada

**Fonte única revisada:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad` (CRC aprovado).

| Fonte original V5.16 | Contrato fiel |
|---|---|
| `cidadao-ai/index.html` `#trafficForm`, `submitTrafficForm()` (linha ~1460) | Sete tipos, local, descrição, foto obrigatória, placa opcional, identidade registrada/visitante, status inicial `RECEBIDA`, categoria `Trânsito (SEMUS)` e destino `SEMUS / Guarda de trânsito` |
| `cidadao-ai/index.html` `makeProtocolId()` (linha ~920) | Identificador legível `JF-YYYYMMDD-######`; sequência transacional evita colisões de relógio |
| `shared/jeriflow-audit-citizen.js` `persistCitizenProtocol()`, `visible()` | Mesmo registro e ID para cidadão, Guarda e SEMUS; visitante exige vínculo privado ao dispositivo (hash técnico), sem nova ocorrência da Guarda |
| `guarda-semus/index.html` `allTraffic()`, `acceptReport()` (linhas ~492, 512) | Consulta/atendimento deverá operar em `app.citizen_v516_traffic_protocols.id`, sem entidade duplicada |
| `admin-semus/index.html` `reopen()`, `closeAdmin()` (~172, 178) | Reabrir/encerrar o **mesmo** ID posteriormente, sem criar outro |

## Esta etapa

- `infra/migrations/005-citizen-v516-traffic-protocol.sql` adiciona UMA tabela de protocolo e uma referência interna à fotografia verificada, sem tabela independente de ocorrências Guarda.
- A fotografia só é elegível quando existir no **gate privado** `app.citizen_v516_verified_traffic_media`, criado apenas por componente confiável de verificação (a role normal da API não tem INSERT/UPDATE nesse gate).
- O envio `app.citizen_v516_traffic_submit(...)` é transacional: identifica cidadão com sessão real V5.16 ou visitante com vínculo de dispositivo, confere município, bloqueio, tipo, campos, existência da fotografia verificada e não utilizada; cria **um único protocolo** no estado `RECEBIDA` e consome a evidência na mesma transação. Falhas não geram protocolo e não consomem a foto.
- `tests/integration/traffic-protocol-v516.test.mjs` usa PostgreSQL REAL porém descartável, contas/identidades e evidências totalmente fictícias. O proprietário de teste insere as fotos no gate para ensaiar a transação — **isso NÃO é verificação antivírus real**.

## Limites obrigatórios / segurança

**Não foi implementado** o worker operacional que, após verificar assinatura, normalização, SHA e varredura ClamAV real, consegue registrar a foto no gate privado. Não há rota de upload, comprovação de dispositivo visitante, frontend RN integrado, APIs autenticadas da Guarda ou SEMUS, recuperação de protocolos, teste físico nem ambiente de homologação. Portanto **nenhum protocolo operacional deve ser emitido até a integração desses controles**.

A role `jeriflow_app` não pode criar registros de mídia verificada nem alterar linhas do protocolo diretamente. O consumidor da função deve ser exclusivamente o backend autenticado, com proteção HTTP, antiabuso e rate limiting antes da exposição. Não interpretar existência do schema como evidência aprovada ou produto pronto.

Migração ainda **não aplicada a servidores reais**, nenhuma `main` modificada; PR deve permanecer DRAFT e encadeada à PR #23. Não usar VPS ou recursos de Ramo Nessa; sem pagamentos online nem recursos ausentes do HTML.
