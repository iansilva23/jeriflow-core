# JeriFlow V5.16 — Fase 17: encadeamento INTERNO e privado da foto de trânsito

**Regra SUPREMA:** Antes de modificar, ZIP `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` foi reaberto. SHA-256: `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad` e `unzip -t` sem erros. Fontes inspecionadas: `cidadao-ai/index.html` `#trafficForm`, `setTrafficPhoto` e `submitTrafficForm`; `shared/jeriflow-audit-citizen.js` `evidence()`, `formIdentity()` e `submitTrafficForm()`. Permanecem sete categorias, foto obrigatória, câmera/galeria, local e descrição, placa opcional, usuário cadastrado ou visitante, destino `SEMUS / Guarda de trânsito`, categoria `Trânsito (SEMUS)` e status `RECEBIDA`. **Nenhuma tela ou regra de produto foi modificada.**

## Pipeline privado, sem protocolo novo

Novo `apps/api/src/traffic-photo-private-pipeline-v516.ts` encadeia:

1. Valida sessão em formato canônico, município, assinatura binária da imagem, MIME e limite de 8 MiB; sem confiar em flags do cliente.
2. Quarentena 0700/0600 privada, UUID aleatório.
3. Decodifica por Sharp e reencoda em WebP sem EXIF/ICC/XMP, largura até 1200 pixels, qualidade equivalente a 70 conforme V5.16.
4. Armazena imagem sanitizada em diretório privado por município, com manifesto e hash SHA-256. Descarta fotografia **BRUTA**, inclusive quando a normalização falha.
5. Reserva a foto à identidade de Cidadão cadastrado usando sessão válida no PostgreSQL e a migração 007; conta, município e SHA vinculados. Não aceita `citizenId`, `photoId` ou hash arbitrário do aparelho.
6. Envia ticket privado ao `OfficialTrafficPhotoWorkerV516`, que exige bases oficiais assinadas, versão carregada `clamd`, leitura íntegra, varredura real e registro SQL privado pela role `jeriflow_v516_scan_worker`.
7. Retorna **recibo privado** para uso **APENAS** pela transação canônica futura `citizen_v516_traffic_submit`, sem criar protocolo por si mesmo, sem imagem pública e sem expor IDs ao HTTP.

A função `createPrivateTrafficPhotoHttpAdapterV516` permite conectar o pipeline à rota POST opt-in da PR #30; a sessão Bearer já validada pelo resolver do backend é passada **internamente**, nunca no corpo nem na resposta. **O `main.ts` permanece inalterado e NÃO fornece a dependência: a rota real continua 503 `NOT_IMPLEMENTED`.**

## Política conservadora de falhas

- Se falhar antes da reserva, descartar também o arquivo WebP recém-criado. Nenhum gate nem protocolo resultam dessa tentativa.
- Se falhar **depois** de reservar a titularidade, **não remover automaticamente** o WebP: o scanner pode ter escrito o registro de elegibilidade no banco em caso de erro parcial; excluir a mídia cegamente poderia criar protocolo com foto ausente. Retém-se tudo em diretório privado para reconciliação transacional posterior.
- A fase seguinte precisa adicionar expiração/limpeza consistente de **reserva + gate + mídia órfãos**, quotas por identidade e município, relatório de tentativas, retry idempotente e parâmetros do proxy HTTPS.
- O adaptador responde `202 PHOTO_RECEIVED` somente quando o callback privado concluiu, **nunca** como confirmação de protocolo SEMUS ou aprovação da denúncia.

## Escopo rigorosamente ainda pendente

- A composição foi testada com **arquivos reais, Sharp, HTTP loopback** e dublês explícitos de `ownership.reserveRegistered` e `worker.verifyAndRegister` para cenários de sucesso/falha. **Não significa** que o ClamAV oficial ou PostgreSQL real foram executados neste teste; essas partes têm provas anteriores separadas nas PRs #24–#31. É desejável criar teste fim a fim com PostgreSQL + daemon real, no **mesmo** CI temporário, antes de habilitar a rota.
- Falta vincular a foto elegível ao envio do formulário completo e emitir um único protocolo canônico na mesma trilha original Cidadão/Guarda/SEMUS. A PR #30, fase 15, trata apenas foto, não recebe dados do formulário.
- Visitantes são compatíveis com a V5.16, mas o `localStorage.deviceId` do HTML não é credencial segura de posse pela internet. O backend segue bloqueando o caminho guest até ser validado um mecanismo de autoria do dispositivo sem inserir campos novos de UI.
- Nenhuma atualização de apps RN/iOS/Android, nenhum deploy/VPS/produção, nenhum merge, pagamento, Ramo Nessa, segredo ou foto real.

**Base exata:** PR #31 HEAD `59e10fb046114f417b5c0ccb5c8bf57082449284`. Nova PR empilhada DRAFT; `main` intacta.

