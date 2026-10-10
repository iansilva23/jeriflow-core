# Auditoria rápida e bloqueio de paridade — PRs #1, #3, #4; PR #2 pendente

**Fonte primária real verificada:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`
SHA-256: `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`.

## Evidência HTML

- `cidadao-ai/index.html`, tela `trafficForm`, ~655–709: `trafficType`, `trafficLocation`, `trafficPlate` opcional, `trafficDescription`, foto obrigatória `trafficCameraInput/trafficGalleryInput`, identificação vinculada.
- `submitTrafficForm()`, ~1460–1465: cria protocolo canônico com categoria `Trânsito (SEMUS)`, destino `SEMUS / Guarda de trânsito`, status `RECEBIDA`.
- `admin-cidadao/index.html`, `isTraffic()`, `openProtocol()`: trânsito é acompanhado, sem substituir atendimento da Guarda.
- Outros fluxos especializados: Sugestões, Água/Cagece, Energia/Enel, outros destinos. Não se devem transformar automaticamente em um único formulário genérico sem campos e destinos próprios.

## PRs #1, #3 e #4 — desvio confirmado

- Todas adicionam `apps/api/src/ouvidoria-input.ts` e `packages/mobile-auth/CitizenProtocols.tsx` com o cadastro genérico por `category/title/description`.
- Categorias técnicas nessas PRs: `denuncia`, `reclamacao`, `solicitacao`, `sugestao` (verificado diretamente em cada branch), não a taxonomia/destinos originais.
- Os pedidos não aceitam no ato de criação `trafficType`, `trafficLocation`, `trafficPlate`, anexação obrigatória de foto nem destino `SEMUS / Guarda de trânsito` como na V5.16.
- Em especial, registro de trânsito sem foto no fluxo genérico não reproduz a exigência da V5.16.

**Conclusão:** as PRs #1, #3 e #4 não são aptas a merge como implementação fiel; fechá-las como bloqueadas, preservando commits/branches para reutilização seletiva de autenticação/validação/segurança e de testes de engenharia. Não fazer reset destrutivo.

## PR #2 — natureza distinta, ainda não concluída

- Contém regressão de navegador do **Bloco 4 — cadastro/gestão de contas**, workflows e pequena correção no painel de contas do ADM Mestre.
- NÃO foi identificada nesta revisão a mesma divergência de categorias/fluxos de Ouvidoria, mas isso **não prova paridade do Bloco 4**.
- Deixar a PR #2 sem merge, pendente de auditoria integral contra autenticação, cadastros e permissões descritos na V5.16, em especial `admin-master/index.html` e telas de login dos apps.

## Caminho correto de retomada

1. Usar a V5.16 como fonte principal: capturar telas/campos/estados/casos negativos por módulo.
2. Reaproveitar seletivamente a engenharia existente, **sem aceitar os modelos funcionais divergentes** das PRs encerradas.
3. Reconstruir primeiro `Cidadão → protocolo Trânsito/SEMUS (foto obrigatória)`, depois `Guarda assume/finaliza` no mesmo protocolo e `ADM SEMUS` acompanha/corrige, conforme HTML.
4. Corrigir demais categorias/destinos da Ouvidoria, interface e notificações nos moldes originais.
5. Somente após testes reais de equivalência no HEAD propor integração; não confundir CI verde com paridade.

`main` não recebeu alterações, e dados reais/VPS de outro projeto não foram utilizados.
