# JeriFlow — laboratório de conciliação: preparação, sem pagamentos

**Base:** PR #12 — estudo tarifário. **Estado:** ensaio técnico de programação, sem dados reais, sem homologação financeira.

## O que este passo implementa

- Motor determinístico de **laboratório** em `packages/contracts/src/parking-finance-sandbox.ts`.
- Casos: sem amostra, evento de confirmação coincidente, replay idempotente, replay conflitante, referência repetida, quantia incompatível, município/pedido divergente, reversão e chargeback simulados, eventos fora de ordem.
- **Sem operações de escrita, sem acesso externo e sem webhook**. Nenhum dado de simulação é persistido no banco, emitido como recibo ou usado para autorizar estacionamento.
- Todos os resultados, inclusive os de correspondência, possuem sempre:
  `simulationOnly:true`, `financialEffectsEnabled:false`, `paymentRegistered:false`,
  `authorizationIssued:false`, `voucherIssued:false`, `debtCreated:false`, `paidUntil:null`.
- Interface protegida do Admin Turismo em `/paineis/turismo/estacionamento/tarifa/conciliacao`, com exemplos locais fixos sem dados pessoais e sem credenciais.
- Testes unitários de coerência, isolação, valores inteiros e importâncias, idempotência e reversões; regressão Chromium a partir da PR #12.

## As limitações são intencionais

O rótulo `simulated_match` NÃO representa pagamento confirmado. Este motor não consegue
verificar autenticidade de PSP, conta recebedora, autorização municipal, pagamento
efetivamente recebido ou reconciliação bancária. **Jamais** usar este módulo como
gatilho para liberar veículos, comprovar TTS, emitir voucher ou preencher `paidUntil`.

Um sistema efetivo exigirá, antes de ativação:
1. Definir oficialmente tarifa, operador financeiro, isenções, cancelamento e devolução.
2. Escolher PSP com contrato institucional, credenciais por ambiente e documentação atual.
3. Validar criptograficamente cada webhook/retorno conforme instruções específicas do PSP,
   buscar/confirmar status no servidor do provedor quando aplicável e bloquear replay.
4. Salvar ordem, tentativa, evento e alteração de saldo em transação PostgreSQL,
   com trilha imutável, idempotência, tenant binding e snapshots dos valores.
5. Tratar parcialidade, pagamento duplicado, confirmação tardia, estorno, chargeback,
   conciliação e auditoria sem deixar pagamento falso liberar acesso.
6. Confirmar em integração real de homologação, com pagamentos de teste do PSP,
   antes de habilitar qualquer fluxo municipal de produção.

## Garantias de não regressão

- PR #7 → #8 → #9 → #10 → #11 → #12 → esta PR, **sem merge automático**.
- Nenhuma migração é criada neste passo; mantém intactas as migrações 001–020.
- Não altera React Native, aplicativos móveis, tabelas nem endpoints de identidade.
- Todo o ambiente funciona sem segredos no GitHub. `main` e VPS do Ramo Nessa não são tocados.
