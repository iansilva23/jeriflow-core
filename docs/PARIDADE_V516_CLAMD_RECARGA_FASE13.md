# JeriFlow V5.16 — Fase 13: clamd carregou a base esperada e confirmou recarga

**Fonte única reaberta ANTES de editar:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`. `unzip -t`: sem erros. `cidadao-ai/index.html` `#trafficForm` e `submitTrafficForm()`; `shared/jeriflow-audit-citizen.js` `evidence()`, `submitTrafficForm()`. Guarda e Admin SEMUS compartilham os protocolos originais.

## Paridade absoluta: nenhum fluxo novo

A mesma denúncia com sete tipos, local, descrição, placa opcional e foto obrigatória continua no App Cidadão. A verificação do scanner é interna: não cria formulário, botão, aprovação de evidência, cobrança, status novo ou ocorrência separada da Guarda.

## Implementação técnica

- `apps/api/src/clamav-daemon-live-v516.ts` consulta `zVERSION\0` por socket Unix **privado**, lê a versão `daily` assinada pelo `sigtool --info` depois de verificar as três bases oficiais e compara a versão que o daemon reporta com a versão do arquivo. Se houver divergência, erro ou base vencida, **falha fechado**. A versão do `clamd` atesta somente o número da `daily` em memória, não atesta diretamente `main`/`bytecode`, banco inteiro, diretório efetivo do daemon ou sua proteção completa.
- `reloadClamdAndVerifyV516()` foi projetado como operação **administrativa privada**, nunca invocada como parte do envio de foto: solicita `zRELOAD\0`, exige resposta `RELOADING` e aguarda a versão da `daily` coincidir. Timeouts, comandos desativados ou resposta incompleta são recusados. **Limite conhecido:** se a versão já coincidia antes do `RELOAD`, esta checagem isoladamente não atesta a conclusão da recarga de `main/bytecode`; é necessária verificação adicional de engine/assinatura por teste real.
- `apps/api/src/traffic-photo-official-worker-v516.ts` exige a verificação daemon/daily ANTES de criar worker, ANTES do scan e novamente após o scan e ANTES de registrar a mídia no gate PostgreSQL.
- `apps/api/src/traffic-photo-verified-worker-v516.ts` recebe hook técnico opcional de pré-gravação, para impedir que o worker oficial reconheça mídia depois de um scan com versão divergente.
- Testes de socket e parser sintéticos validam protocolo, falha fechada e diferença entre versão da engine e da base. Teste separado executa **daemon clamd verdadeiro** com assinaturas locais inofensivas em duas imagens WebP e observa que a segunda assinatura só é reconhecida depois de `RELOAD`. Sem bases oficiais nesse job automático para evitar requisições recorrentes à CDN.

## Segurança que ainda falta

Esta etapa não prova que `clamd` operacional do servidor tenha carregado todas as bases oficiais, nem testa recarga `freshclam` em um serviço persistente do usuário. A PR #27 provou que bases `main`/`daily`/`bytecode` foram baixadas e verificadas em runner descartável; PR #26 testou clamd verdadeiro com assinatura sintética. Fase 13 liga a validação da versão `daily` a uma proteção de worker e ensaia a recarga real, mantendo essas limitações explícitas.

Pendente: serviço separado de atualização e recarga confiável, vinculação da identidade/dispositivo visitante, upload HTTP protegido, app React Native conectado, fluxo Guarda/SEMUS fim a fim, política LGPD de retenção, homologação física e produção. Sem VPS, merge, segredos, servidor de outro projeto ou recursos ausentes na V5.16.

**Base:** PR #27 commit `89fe7c260a09d2ae2139e84dfb0d0d0241b92971`. Manter esta PR DRAFT encadeada, sem alterar `main`.
