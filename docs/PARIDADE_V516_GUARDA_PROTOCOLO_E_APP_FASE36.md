# JeriFlow V5.16 — continuidade da Guarda (validação antes de conectar RN)

## Fonte obrigatória e auditoria anterior
- ZIP original conferido em bytes: `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`; SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`.
- Reaberto `guarda-semus/index.html`: `acceptReport()`, `renderQueues()`, `finishBtn`, `serviceResult`, `serviceAction`, `onShift`.
- Estado auditado: PR #50 head `f0b4474c22777511ad9904ee2a02d8f7e8064509`. `apps/guarda/App.tsx` monta somente `packages/mobile-auth/AuthApp.tsx` (SHA `23608dd435880f781a4bf8fedf39730a855c2241`); a tela operacional não está implementada neste arquivo.
- A API de mutação existente opera por injeção opcional; `apps/api/src/main.ts` não injeta serviço e permanece desligada.

## Ajuste estritamente necessário
- O adaptador HTTP da PR #50 reconhecia `JF-AAAAMMDD-NNNNNN` com seis **ou mais** dígitos finais. Esta etapa torna os seis dígitos obrigatoriamente exatos, preservando todas as outras regras e rotas.
- Teste de regressão exercita diretamente o servidor HTTP com protocolos de comprimento incorreto e garante que nenhuma função SQL é chamada.

## Limites
Não implementa ainda interface RN, plantão HTTP, notificações, foto de conclusão, sincronização ou ativação da rota no servidor normal. Não altera SQL, autenticação, permissões, esquema ou protótipo. A integração RN deve ser desenvolvida com base no fluxo real do HTML, na sessão segura de `AuthController` e em testes isolados antes de qualquer implantação. Sem merge na main ou VPS.
