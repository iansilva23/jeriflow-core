# JeriFlow V5.16 — Fase 15: contrato HTTP da foto de denúncia de trânsito (DESATIVADO por padrão)

**ÚNICA autoridade de produto reaberta antes de editar:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`; `unzip -t` sem erros. Conferidos `cidadao-ai/index.html`, `#trafficForm` (linhas 655–707), `setTrafficPhoto` e `submitTrafficForm` (~1440–1480), e implementação efetiva `shared/jeriflow-audit-citizen.js` `evidence()` / `submitTrafficForm()`.

O formulário original continua com câmera/galeria, sete opções idênticas, local, descrição, placa opcional, foto obrigatória e identidade de Cidadão cadastrado ou visitante com nome/nascimento/telefone. O produto HTML **não tem processador de pagamento e não autoriza campos/telas extras**.

## O que foi criado nesta PR empilhada

- `apps/api/src/traffic-photo-http-v516.ts`: fronteira técnica HTTP isolada. Aceita apenas POST de bytes crus de imagem, Bearer session válido e município confirmado pelo resolvedor backend. Limite 8 MiB tanto via Content-Length quanto por streaming, validação MIME **e assinatura do arquivo**, rejeição de Content-Encoding, controle de corpo vazio/abortado. Nunca confia em `registered`, foto aprovada, ID de protocolo ou flags informados pelo cliente. Não retorna hash, ID da mídia, caminho privado ou dados pessoais.
- `apps/api/src/server.ts`: suporta opcionalmente `/api/v1/citizen/traffic/photo`. **DESATIVADA POR PADRÃO**: `main.ts` não injeta `trafficPhoto`, portanto responde 503/NOT_IMPLEMENTED; upload real não está habilitado. Apenas o teste local injeta resolvedor e processador fictícios. Contém limite de duas requisições simultâneas quando explicitamente configurada.
- `tests/traffic-photo-http-v516.test.mjs`: requisições HTTP REAIS em `127.0.0.1` e imagens Sharp sintéticas; confirma 503 padrão, ausência de aceitação anônima, token e tenant checados, moderação, falsificação de metadados, 8 MiB, MIME real, falha do processador, resposta 202 sem protocolo e ausência de leak de foto. Sem gravação de foto real, banco ou VPS.
- Workflow automático `v516-traffic-photo-http.yml` para TypeScript, testes HTTP e regressão de contrato.

## Restrições de segurança ainda BLOQUEANTES

1. **Visitante** existe na V5.16, mas não há ainda verificação backend confiável do identificador/dispositivo e sua propriedade da foto. Esta fronteira HTTP aceita somente conta com sessão válida. Não remover a opção visitante da interface; completar a vinculação do visitante antes de habilitar a rota em ambiente real.
2. `ingestVerifiedPhoto` é uma **dependência obrigatória injetada por servidor confiável**, não um serviço implantado. Ainda precisam ser ligadas a quarentena, normalização, armazenamento limpo, scanner oficial e transação de vínculo ao protocolo. Os testes só comprovam a fronteira HTTP, não processamento/escaneamento real por esta rota.
3. No gate PostgreSQL da PR #24 ainda falta uma autorização de PROPRIEDADE da foto por identidade/titular confiável; nunca publicar `photoId` ou `photoSha` ao cliente sem resolver isso. O ticket não aparece na resposta.
4. Antes de produção: limite distribuído por conta/IP, quotas de armazenamento e limpeza de órfãos, upload em streaming sob proxy HTTPS seguro, auditoria/observabilidade, scan oficial contínuo, política LGPD, testes no app RN, Guarda e SEMUS. **Não alegar foto enviada à Guarda** só porque HTTP respondeu 202 num ambiente de teste.
5. A V5.16 original HTML segue intocada; sem merge, deploy, VPS, Ramo Nessa, segredos ou dados de cidadãos.

**Base deste PR:** PR #29 commit `409801a2306b76a2e281fe8dcf15ce1bcb744951`. PR empilhada DRAFT.
