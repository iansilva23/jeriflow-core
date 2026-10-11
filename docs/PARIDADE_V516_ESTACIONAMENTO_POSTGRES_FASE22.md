# JeriFlow V5.16 — Fase 22: cadastro e movimentações de estacionamento PostgreSQL

## Regra suprema: consultar antes de alterar

A V5.16 original foi consultada **antes de cada implementação**: `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, integridade ZIP confirmada. `admin-turismo/index.html`: `saveReg`, `stayState`, `saveExtension`, `registerManualExit`, `confirmTolerance`, `confirmPhysicalExit`, `parkingVoucherHtml`.

GitHub: examinadas PRs #5–#9 (migrações 001–017, com arquivos 011–017 **incompatíveis** com os nomes de fases recentes) e a PR #36. **Nenhum arquivo anterior foi substituído.** Esta etapa adiciona uma migração isolada `020-parking-v516-register-extensions-exit.sql`; o número 020 não declara que 011–019 tenham sido integradas ou homologadas. Antes de integrar com outras PRs, a ordem de migrações deve ser consolidada e testada, sem renomear nem sobrescrever scripts históricos arbitrariamente.

## Base implementada, isolada e desativada por padrão

- `parking_v516_tariffs`: tarifa diária configurável em centavos, originalmente **desabilitada**. Só um processo institucional autorizado deve registrar valor, operador responsável, data de aprovação e ativar; **R$40** é apenas a referência do HTML, não preço oficial ou validado.
- `parking_v516_registrations`: registro seguro por município e atendente, placa, marca, modelo, ano, responsável, turistas, hospedagem, dados de contato, data/hora efetiva da entrada, dias já pagos, vencimento exato em 24h por diária, confirmação de não reembolso para antecipações e saída registrada.
- `parking_v516_movements`: movimentação **de pagamento efetivamente recebido** pelo atendente, valor em centavos, meio, quantidade de diárias, operador e timestamp. Nenhuma cobrança online, Pix, cartão ou gateway acionado.
- `parking_v516_exit_audit`: trilha da baixa física, tolerância sem cobrança e saídas antecipadas, independente da TTS.
- Funções privadas `parking_v516_register`, `parking_v516_extend`, `parking_v516_confirm_exit`: sessão PostgreSQL/MFA real, município ativo, permissão `admin-turismo` ou Mestre com MFA, tabelas privadas da API, serialização por linha `FOR UPDATE`, request IDs de idempotência, transações atômicas. Sem CRUD direto da role HTTP.
- A antecipação das diárias exige reconhecimento explícito sem reembolso. Extensão adiciona dias ao vencimento já pago. Vencimento **não efetua saída nem cobrança**. Tolerância exige justificativa e registra saída física sem movimento financeiro. Saída antecipada pode aplicar a regra sem estorno ou registrar encaminhamento para coordenação; **não** processa ou inventa devolução de dinheiro.

## Explicitamente não implementado nesta etapa

- Aprovação oficial de tarifas e ciclo de contas de coordenação/PIN reforçado, registro de estorno real de exceção, recuperação/uso de token privado pelo Turista, voucher impresso, upload de fotos de veículo/comprovante, integração física dos painéis e aplicativos, consultas de estacionamento por perfis e MFA de todos os fluxos.
- Nenhuma TTS é emitida automaticamente; o certificado/autorização oficial é processo separado que depende de autoridade.
- Não existe rota HTTP nova ou serviço implantado. O ambiente `main.ts` ainda bloqueia produção. Migração 020 existe apenas em branch DRAFT, testada em PostgreSQL descartável.
- A API não calcula ou recebe valores arbitrários do aplicativo para autorizar cobrança; o valor é extraído da tarifa aprovada armazenada para o município.
- Regras municipais de diárias, aceitação de dinheiro e reembolsos devem ser formalizadas/validadas antes de produção.

**Base:** PR #36 `cf7980d1b20b8f92ac13e5b4402635e604d6b9c2`. Nova PR empilhada DRAFT. `main`, VPS, HTML e Ramo Nessa permanecem intocados.
