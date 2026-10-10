# JeriFlow V5.16 — Fase 10: ligar verificação privada ao gate PostgreSQL

**Fonte única previamente reaberta e verificada**: `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`; `unzip -t` sem erros.

## Regras do HTML preservadas

- `cidadao-ai/index.html` formulário `#trafficForm` (~659–708): denúncia de trânsito usa exatamente as sete opções originais, localização, descrição, foto obrigatória, placa opcional e dados de Cidadão/visitante.
- `shared/jeriflow-audit-citizen.js` `evidence(file)` e `submitTrafficForm()`: 8 MiB, renderização a 1200px/qualidade 0,7, categoria `Trânsito (SEMUS)`, destino `SEMUS / Guarda de trânsito`, status inicial `RECEBIDA`. O worker **não modifica nenhuma dessas regras**.
- `guarda-semus/index.html` `allTraffic()`/ `acceptReport()`, `admin-semus/index.html` `reopen()`/ `closeAdmin()`: consultar e atualizar o mesmo protocolo; **não foi criada tabela alternativa**.

## Implementação técnica isolada

1. `infra/migrations/006-citizen-v516-scanned-photo-worker.sql` cria o papel interno `jeriflow_v516_scan_worker` **NOLOGIN** e uma função `app.citizen_v516_record_scanned_media`. A API `jeriflow_app` não pode chamá-la nem escrever na tabela de evidências; credenciais worker exigem configuração separada, ainda não aplicada a VPS.
2. `apps/api/src/traffic-photo-verified-worker-v516.ts` abre armazenamento privado, recusa identidade de banco superusuário/API, chama `scanStoredTrafficPhotoV516()` pelo socket Unix `clamd`, confere novamente a integridade da foto limpa, e só então registra município/UUID/SHA na tabela de elegibilidade `app.citizen_v516_verified_traffic_media`. Sem formulário extra, endpoint, protocolo criado, URL pública ou mudança visível ao Cidadão.
3. `tests/integration/traffic-photo-worker-v516.test.mjs` com PostgreSQL real efêmero testa acesso negado, malware, scanner indisponível, foto íntegra, SHA adulterado e não duplicação. **O daemon nos testes é SIMULADO** e não certifica proteção antivírus real.

### Escopo e obrigações de segurança restantes

- **Scanner ClamAV real e definições atualizadas NÃO foram homologados.** Até a verificação real em ambiente segregado o resultado é exclusivamente integração técnica.
- O papel NOLOGIN não oferece conexão de produção sozinho; atribuir a conta de processo com credencial secreta fora do GitHub e proibir a credencial de `jeriflow_app` de possuir esse papel. Testes usam senha descartável e fictícia.
- O processo privado de foto ainda NÃO foi ligado a HTTP/upload/app RN, nem preparado um serviço permanente/observabilidade para a fila.
- A função `app.citizen_v516_traffic_submit()` continua responsável por **consumir a mídia elegível e criar um único protocolo** em transação, após checar identidade Cidadão ou visitante.
- Vinculação confiável de dispositivo visitante, prevenção de abuso de foto/upload, autorização Guarda/SEMUS e observabilidade/reconciliação de arquivos/banco ainda pendentes.
- A existência de mídia no gate não é aprovação automática de uma denúncia (evidenceApproved continua `false`). Não tocar `main`, VPS, aplicativo Ramo Nessa, produção ou dados pessoais reais; PR DRAFT e sem merge.
