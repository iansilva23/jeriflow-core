# JeriFlow V5.16 — Fase 25: voucher imprimível do Estacionamento

**Regra suprema:** revisado ZIP original V5.16 SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad` antes de editar. `admin-turismo/index.html`, funções `parkingVoucherHtml`, `voucherEsc`, `voucherPaymentHistory`, `voucherStatus`, `paidUntilDate` e `printParkingVoucher`. Conferida a inexistência do novo arquivo e do teste no HEAD da PR #39. **Nenhum HTML, componente ou tabela existente foi sobrescrito.**

## Componente interno construído

A nova função `createParkingVoucherHtmlV516` gera HTML estático de impressão a partir de dados já comprovados pelo backend: cliente, documento/telefone, turistas, placa, marca/modelo, hospedagem, entrada, horas de 24h, situação física, vencimento, pagamentos recebidos, forma, histórico de extensões, valor total e chave privada JFPK para o App Turista.

Os valores são conferidos em **centavos** com o total contábil e o número de diárias; inconsistências resultam em erro (fail-closed), não em voucher falso. O vencimento é avaliado pelo horário exato e pela data civil `America/Fortaleza`. O texto diferencia pendência e saída registrada. Antecipação de várias diárias é informada sem declarar estorno executado.

Todo texto fornecido pelo operador é escapado (`&<>"'`) para impedir marcação/JavaScript arbitrários, inclusive em nome, documento e hospedagem. O HTML não contém scripts ativos e depende da funcionalidade de impressão do navegador/ADM futuro; não exibe QR-TTS nem afirma que o voucher seja documento fiscal.

A chave de viagem só pode ser obtida do `ParkingAccessServiceV516.reprint` ou emissão segura da PR #39 por operador autorizado com MFA. O voucher não recebe um token fictício público nem busca PII na internet.

## Bloqueios

- A impressão real depende de rota e painel ADM protegidos com controle de autorização e antifraude, ainda não ligados. Este arquivo apenas gera HTML.
- Deve-se unir dados do PostgreSQL com movimentos 020 e chave de acesso 022, monitorar reimpressões e evitar cópias de PII em logs.
- A TTS continua independente do estacionamento e não é emitida, validada ou prorrogada pelo voucher.
- Sem geração de PDF, envio por WhatsApp, terceiro provedor, gateway financeiro, deploy, app RN ou mudança no HTML original. Antes da entrega ainda faltam homologação institucional, LGPD e teste de impressão física.
- Sem merge: nova PR empilhada na #39, `main` e VPS intactos. Respeitar colisões de numeração de migrações antigas ao integrar toda a cadeia.

**Base PR #39:** `3f891e013739cd8859676c3bad0ec146ac1e8eeb`.
