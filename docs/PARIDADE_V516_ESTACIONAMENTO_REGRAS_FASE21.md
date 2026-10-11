# JeriFlow V5.16 — Fase 21: regras isoladas de Estacionamento

## Verificação antes de escrever — regra de não sobrescrever

O pacote original `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` foi inspecionado, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`. Referência: `admin-turismo/index.html`, especialmente `paidUntilDate()` (linha ~621), `stayState()` (~965), `saveReg()` (~1179), `registerManualExit()` (~1315), `saveExtension()` (~1330), `confirmTolerance()` (~1337), `coordinatorRegisterRefund()` (~1395).

Antes de criar arquivos foram examinados a árvore do GitHub no HEAD da PR #35, as pastas da API, as migrações existentes, as páginas admin e os quatro aplicativos. O nome `parking-stay-policy-v516.ts` não existia, e o teste e workflow foram checados por caminho. Não foi sobrescrita nenhuma implementação preexistente de Estacionamento e nenhuma branch anterior foi alterada.

## Esta PR implementa somente uma biblioteca pura e testes

- Período inicial: 1 diária corresponde a 24 horas EXATAS desde a entrada registrada.
- Múltiplas diárias somente com reconhecimento explícito da regra de não reembolso antecipado.
- Valor histórico configurável em centavos (exemplo R$ 40,00, não valor oficial/ativado automaticamente).
- A permanência não é encerrada por previsão nem por pagamento vencido; só pela saída realmente registrada.
- Estado `OVERDUE` e quantidade de diárias vencidas calculados após o instante exato de `paidUntil`. Sem cobrança automática.
- O rótulo `DUE_TODAY` respeita a data local de Jericoacoara (America/Fortaleza), não o dia em UTC do runner.
- Extensão soma ao vencimento já pago, inclusive após atraso, sem substituir a data da entrada.
- Uma saída normal vencida requer regularização/tolerância; uma saída antecipada de múltiplas diárias precisa seguir a regra de não reembolso ou encaminhamento ao coordenador, conforme a V5.16. A biblioteca **não executa** essas duas operações especiais.

## Limites e próximos passos obrigatórios

**Não existe nova tabela nem endpoint nesta PR.** O SQL de Estacionamento deve ser projetado depois da conciliação das migrações existentes nas PRs paralelas (#5–#35), para não colidir com números de migração e serviços já construídos. Essa etapa de política pura não cadastra veículo, não recebe dinheiro, não emite voucher/token, não aciona TTS, não faz baixa de saída em banco, não publica app nem altera UX. Nenhuma evidência de operação em produção.

Próximos passos: revisar todas as migrações e PRs prévias (sem sobrescrever), fechar o modelo canônico de estacionamento, separar a TTS da estadia, montar as transações da API e testes PostgreSQL, conectá-las aos ADMs e App Turista. Valor de diária, forma de recebimento e poderes da coordenação precisam de aprovação institucional; nunca inferir regras de uma plataforma de cobrança.

**Estado:** branch derivada exclusivamente da PR #35, PR DRAFT, `main` e VPS sem alterações.