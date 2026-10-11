# JeriFlow V5.16 — Fase 23: consultas seguras para ADM Turismo

**Fonte absoluta revisada antes dos commits:** ZIP V5.16 SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, `admin-turismo/index.html` funções `stayState()`, `renderAll()`, `dueState()`, `paymentMovements()`. Adições em **novo arquivo 021**, depois da migração 020, preservando todos os scripts anteriores. Não implementar nem modificar a antiga fila `parking_service_requests` como se fosse o estacionamento canônico.

## Capacidade adicionada

- Consulta `app.parking_v516_admin_list`: autenticação admin-município/MFA pela mesma função segura da fase 22, filtro operacional e paginação até 50 registros, todos restritos ao **mesmo município**.
- Estados derivados da entrada, vencimento de 24 h e saída REAL, no fuso `America/Fortaleza`: `UPCOMING`, `PARKED`, `DUE_TODAY`, `OVERDUE`, `EXITED`. Não muda os estados ou regras da V5.16.
- `app.parking_v516_admin_summary`: contagem de veículos PRESENTES (não apenas dentro da diária), saídas, vencidos, diárias vencendo hoje, total e soma dos recebimentos MANUAIS registrados no histórico. Nenhuma chamada bancária, estorno ou autorização TTS é feita ou inferida.
- Somente `EXECUTE` das funções estreitas é concedido a `jeriflow_app`. Nenhum SELECT/UPDATE da tabela de cadastro, de dados pessoais ou dos movimentos financeiros é liberado à API. As funções recusam sessão vencida, falta de MFA, acesso à prefeitura errada e perfil `turista`.
- Testes PostgreSQL 17 verdadeiros com cadastros/saídas sintéticos, movimentação financeira, filtro, paginação e isolamento municipal; TypeScript e regras puras de diárias testados no mesmo HEAD.

## Limites

- Esta camada é apenas de leitura interna. A página ADM Turismo real ainda não chama essas funções; falta o roteamento HTTP autenticado e a UI operacional.
- Vouchers, tokens de viagem, foto/recibo, configuração de tarifa institucional, exceção do coordenador com segundo fator específico, transporte/chat, TTS oficial e relatórios completos ainda estão pendentes.
- O retorno autorizado contém PII da hospedagem e turistas; autorização por órgão, logging de consultas, retenção e minimização LGPD precisam ser homologados antes de exposição HTTP.
- Não aplicar migrações 020–021 fora de PostgreSQL descartável até consolidar toda a pilha de PRs de Ouvidoria/Guarda/Estacionamento. Não alterar `main`, VPS, produção ou V5.16 original.

**Base:** PR #37 HEAD `11ff12591f989a89654a7de592cfe8cb5e1379ca`, branch DRAFT independente, sem merge e sem substituir implementações anteriores.
