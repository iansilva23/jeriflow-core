# JeriFlow — preparação financeira para estacionamento, sem cobrança

**Estado:** desenvolvimento experimental, apenas dados fictícios. **Base:** PR #11 / migração 019. **Nova migração:** 020.

## Implementação entregue

1. Isola proposta de valor por período de 24 horas no município, com estado fixo `draft` e valor monetário em centavos BRL. Nenhum valor padrão é configurado.
2. Controle de revisão otimista (0 na criação, a partir de 1 ao salvar), chave de idempotência, histórico imutável da proposta e RBAC `admin-turismo` por município.
3. Consulta opcional de registro de entrada fictícia e simulação `plannedDays × dailyRateCents`; somente horário planejado e valor teórico, sem eventos de cobrança.
4. Tela separada no Admin Turismo para registrar proposta fictícia, consultar simulação e histórico.
5. APIs restritas `/parking/tariff/query`, `/parking/tariff/mutate`, `/parking/tariff/history`, contratos estritos e testes de integração PostgreSQL + Chromium.

## Invariantes essenciais

- Banco **não tem** estado de aprovação/ativação: `approval_state = 'draft'` é protegido por CHECK.
- Nenhuma função ou tabela deste módulo representa dívida, comprovante, Pix, cartão, lançamento contábil, `paidUntil`, guia de pagamento ou direito de estacionar.
- `payable:false`, `paymentRegistered:false`, `authorizationIssued:false`, `debtCreated:false`; consulta também retorna `voucherIssued:false`.
- A simulação **muda se a proposta de valor for alterada**. Isso é deliberado e impede interpretá-la como obrigação ou lançamento histórico. Um futuro ledger legal deverá ter snapshots imutáveis e eventos confirmados de pagamento, não usar este rascunho como fonte de cobrança.
- Usuário sem vínculo municipal ativo ou perfil `admin-turismo` não tem acesso. API/conta scanner não podem ler tabelas diretamente; sem alterações nas permissões do núcleo de identidade.
- Todas as migrações são aditivas (020 não altera checksums 001–019). Nunca conectar a função de simulação a emissão de voucher, TTS ou cobrança.

## Decisões que continuam pendentes

- Instrumento municipal e autoridade que definem tarifa real, isenções, meios de pagamento e regras específicas da V5.16.
- Definição do que é diária efetivamente quitada e tolerância/exceção, incluindo auditoria e reversão.
- Integração com PSP e confirmação confiável, reconciliação, estorno, conciliação financeira, proteção antifraude e dados pessoais/LGPD.
- Aceitação institucional, homologação real no VPS específico do JeriFlow e testes Android/iOS físicos.

## Integração de branches

PR #7 → #8 → #9 → #10 → #11 → nova PR (tarifa). A PR #6 inclui migrações conflitantes. Nunca mesclar automaticamente na `main`. Não usar VPS do Ramo Nessa. Todo código de migrações fica em branch protegida sem execução de produção.
