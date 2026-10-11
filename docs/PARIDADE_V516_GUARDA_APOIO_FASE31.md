# JeriFlow V5.16 — Etapa 31: solicitação de apoio da Guarda

## Verificação obrigatória e preservação

Arquivo original `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, íntegro. Foram lidos ANTES desta etapa o `guarda-semus/index.html` (`#supportModal`, `#supportSend`, quatro `option` de motivo e `textarea`) e `shared/jeriflow-audit-guarda.js` (`#supportReason`, `#supportNote` e evento `guard_support_requested` em `MASTER_EVENTS_KEY`). A base PostgreSQL 001–025 e as migrações de protocolo único foram verificadas.

A tabela `app.guard_v516_support_requests`, função e CI são **novos arquivos**, sem sobrescrever os anteriores. O teste PostgreSQL existente foi ampliado preservando todos os casos de assumir/finalizar/plantão.

## Implementado no backend privado

- `app.guard_v516_support_submit` aceita exclusivamente os quatro motivos originais: `Necessidade de outro agente`, `Via bloqueada`, `Conflito no local`, `Outro`, mais observação opcional. Valida a sessão real do próprio guarda, a prefeitura e a existência do protocolo canônico.
- O HTML original mostra a ação enquanto a denúncia está `RECEBIDA` ou `EM ATENDIMENTO`, mas não em `FINALIZADA`; o backend segue essa regra, sem introduzir estado de denúncia ou status de apoio.
- Os pedidos ficam em tabela privada com `request_id` UUID único. Repetição recupera o mesmo pedido; a mesma chave com campos/autor diferentes é recusada. Duas conexões enviando o mesmo UUID ao mesmo tempo não duplicam a requisição.
- `app.guard_v516_support_admin_queue`: permite ao ADM SEMUS com associação municipal ativa consultar o histórico de pedidos de apoio daquele município; traz protocolo, agente, motivo e observação, sem dados pessoais do denunciante. Paginação limitada a 50.
- Role HTTP tem somente EXECUTE nas funções; não recebe SELECT direto. Worker de varredura e reconciliador de fotos não podem emitir pedidos.
- Nenhuma alteração no Cidadão, status `RECEBIDA/EM ATENDIMENTO/FINALIZADA`, protocolo `JF-...`, armazenamento de fotos ou autoridade de finalização.

## Limites explícitos

**Um pedido gravado não significa notificação entregue à central ou despacho confirmado.** Esta etapa só persiste e disponibiliza a fila em uma consulta interna; ainda falta consumir o evento no ADM Mestre/central que a V5.16 original representa pelo `MASTER_EVENTS_KEY`, criar a rota autenticada, conectar app da Guarda e implementar notificação comprovada com ACK se houver tal mecanismo na base original. Não inventar confirmação de recebimento nem status de despacho fora da V5.16.

Também faltam sinalização do denunciante, anexos de evidência, reabertura/encerramento administrativo e homologação em smartphones reais. O plantão é estado declarado (não heartbeat) e não bloqueia aceitar/encerrar na V5.16 original. Sem merge, VPS ou mudanças em `main` e HTML.

**Base:** PR #45 `49ac89be9abe60214bb58c7b645dfdc21a6c0dfc`. Nova PR DRAFT empilhada, CI PostgreSQL 17.
