# JeriFlow V5.16 — Fase 12: bases oficiais verificadas antes do scanner

**Base original reaberta e íntegra ANTES de editar:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad` e ZIP CRC aprovado. Referências: `cidadao-ai/index.html` `#trafficForm` (~655–708), `submitTrafficForm()` (~1460), `shared/jeriflow-audit-citizen.js` `evidence()` e `submitTrafficForm()`.

## Paridade de produto

**NENHUMA mudança de UX/contrato V5.16.** Cidadão continua com sete tipos de trânsito, localização, descrição, identificação, placa opcional e foto obrigatória. A foto é mantida privada, a categoria continua `Trânsito (SEMUS)`, o destino `SEMUS / Guarda de trânsito` e o protocolo canônico único permanece condicionado à transação da PR #24. Nada de pagamentos, novos campos de cadastro, aprovações de evidência por flags do cliente ou fluxos inventados.

## Entrega de segurança sem expor API

- `apps/api/src/clamav-official-readiness-v516.ts`: valida `main`, `daily` e `bytecode` por `/usr/bin/sigtool --info` **REAL**, exigindo `Verification OK` emitido pela ferramenta do ClamAV. Rejeita diretório relativo, link simbólico, arquivo não regular, ausência de base, DB com assinatura não verificável, timestamp futuro e `daily` com mais de **72 horas**. `main`/`bytecode` podem ter datas antigas porque o ClamAV não as publica necessariamente diariamente. Verifica alterações no arquivo entre inspecionar e validar.
- `apps/api/src/traffic-photo-official-worker-v516.ts`: **novo ponto de entrada privado** que bloqueia a criação/uso do worker da PR #25 antes de a verificação oficial ser bem-sucedida. Revalida a cada nova foto, não expõe rota e não altera a API pública.
- `scripts/check-official-clamav-v516.mjs`: comando auditável para uso futuro no ambiente próprio: `CLAMAV_DATABASE_DIR=/diretorio/assinaturas node scripts/check-official-clamav-v516.mjs`. Não faz downloads; falha com código não zero.
- `tests/clamav-official-readiness-v516.test.mjs` e `tests/traffic-photo-official-worker-v516.test.mjs`: rejeição de falsificações e bases ausentes, idade, campos e fail closed com `sigtool` instalado.
- Workflow com **jobs separados**: (1) teste determinístico com `sigtool` real; (2) **uma tentativa** isolada de download das bases oficiais via **FreshClam**, seguida da checagem. Este segundo job marca `steps.official.outcome` explicitamente no GitHub Summary. Download pode não ser possível em runner GitHub compartilhado por rate limiting/403/429, incompatibilidade de engine ou tempo de execução: **se falhar, a verificação oficial fica NÃO COMPROVADA**, ainda que testes unitários e o job sejam verdes. Não fazer loop de solicitações; respeitar CDN ClamAV.

## Limites / pontos ainda bloqueantes

1. A checagem da assinatura dos arquivos **não comprova que o daemon em execução tenha carregado a mesma versão**. A futura homologação deve associar o diretório de assinaturas do daemon ao resultado do `sigtool`, verificar versão live de `clamd` e forçar recarga após `freshclam`.
2. `sigtool` pode não fornecer `Verification OK` para formatos `.cld` incrementais em determinadas versões. A política desta etapa **falha fechada**, inclusive se o FreshClam tiver atualizado com sucesso mas a verificação não conseguir confirmar assinaturas. É necessário resolver esse caso com mecanismo oficialmente suportado antes de produção; nunca relaxar para mera data/extensão.
3. O `OfficialTrafficPhotoWorkerV516` é **biblioteca interna**, ainda não o serviço do servidor. O worker antigo continua disponível para a suíte da PR #25, mas nenhuma rota de produção foi ligada a ele. Na integração real usar exclusivamente o wrapper fechado com as verificações obrigatórias.
4. Ainda falta ingestão HTTP de foto, scanner com definições oficiais/recarga em serviço, comprovação de vínculo do visitante/deviceId, integração RN, autorização operacional de Guarda/SEMUS, homologação em dispositivos e política de LGPD/retenção.
5. O teste de FreshClam num runner efêmero **não instala nem mantém** antivírus em VPS, nem comprova prontidão para produção. Nenhum arquivo real de cidadão, segredo real ou produção foi utilizado.

ClamAV oficial: https://docs.clamav.net/manual/Usage/SignatureManagement.html e https://docs.clamav.net/faq/faq-freshclam.html . O ClamAV orienta usar FreshClam/cvdupdate em vez de downloads diretos, devido a rate limiting em infraestrutura compartilhada.

PR baseada na #26, sempre DRAFT; nenhuma alteração em `main`, VPS, Ramo Nessa, apps/ADM ou pagamento.
