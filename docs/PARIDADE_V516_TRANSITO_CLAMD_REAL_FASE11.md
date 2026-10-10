# JeriFlow V5.16 — Fase 11: teste do daemon ClamAV **verdadeiro** em CI

**Fonte única original novamente conferida ANTES de alterar o repositório:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`. Referências confirmadas em `cidadao-ai/index.html` linhas ~655–708 e ~1460–1465, e `shared/jeriflow-audit-citizen.js` `evidence()` / `submitTrafficForm()`.

## Paridade V5.16, sem novas telas ou estados

O Cidadão segue com exatamente **sete categorias de trânsito**, local, descrição, placa opcional, identificação e **fotografia obrigatória**. O código HTML limita o arquivo a 8 MiB e reencoda imagens em aproximadamente 1200 px/70%. A proteção com scanner é estritamente interna: não cria pagamento, checkbox, nova permissão de interface, fase da denúncia, protocolo duplicado ou URL pública.

## O que a PR ensaia

- `.github/workflows/v516-traffic-clamd-real.yml` instala um **executável real** de `clamd` num runner temporário GitHub Actions, com PostgreSQL 17 igualmente descartável; sem usar VPS, containers do usuário ou contas pessoais.
- `tests/integration/traffic-photo-clamd-real-v516.test.mjs` inicializa o **daemon verdadeiro** em socket Unix privado, usa `zPING\0` e `zINSTREAM\0` (quadros de comprimento uint32 BE) e envia duas imagens WebP sintéticas produzidas pelo Sharp.
- A assinatura de bloqueio **não contém malware**: a suíte cria localmente um arquivo `.hdb` com MD5 de uma das imagens de teste. O daemon real precisa dizer `FOUND` para ela e `OK` para a outra, o scanner precisa recusar a marcada e o worker só pode cadastrar a mídia limpa em `app.citizen_v516_verified_traffic_media`.
- O registro no gate NÃO cria protocolo, NÃO libera `evidenceApproved`, NÃO dá acesso ao Cidadão a dados da Guarda e NÃO modifica o contrato do HTML.
- Testes adicionais existentes com daemon simulado cobrem indisponibilidade, mensagens corrompidas, trocas de SHA e acessos não autorizados.

## Limites obrigatórios: NÃO equivale a antivírus de produção

1. **Assinatura de teste controlada não é base oficial atualizada.** Este teste valida engine, protocolo, detecção com `.hdb`, socket Unix e integração SQL, **não a capacidade de identificar ameaças reais contemporâneas**. Para homologar produção, provisionar ClamAV com bases oficiais verificadas/atualizadas, observabilidade de atualização, política de falha fechada para assinaturas ausentes/desatualizadas e testes específicos, SEM chaves no GitHub.
2. Não há `clamd` implantado no servidor de homologação do JeriFlow. Não há processamento real de foto de usuário, HTTP/upload, telas React Native conectadas ou vínculo robusto de dispositivo visitante.
3. Código da PR #25 de worker continua interno e exige credencial PostgreSQL separada. Nenhum contrato da V5.16 permite ao cliente declarar `malwareScanned:true` ou aprovar evidência.
4. Esta PR permanece **DRAFT**, baseada na PR #25; sem merge, produção, VPS, Ramo Nessa ou mudança em `main`.

**Referência técnica externa** (não autoriza nenhuma mudança de regra de produto): manual `INSTREAM` do ClamAV https://docs.clamav.net/manual/Usage/ClamdProtocol.html e formato `.hdb` https://docs.clamav.net/manual/Signatures/HashSignatures.html.
