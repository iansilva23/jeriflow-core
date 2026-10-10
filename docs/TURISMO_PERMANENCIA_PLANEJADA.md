# JeriFlow — Estacionamento: planejamento experimental de 24 horas

**Referência:** V5.16 — regras históricas de diária de 24 horas, pendências e extensões.
**Base de implementação:** PR #10 (`feature/turismo-cadastro-entradas-saidas-20261010`).
**Estado:** primeira paridade **parcial e NÃO financeira**, exclusivamente em ambiente de desenvolvimento.

## Implementado
- Migração aditiva **019**, sem modificar checksums das migrações 001–018.
- Cada entrada fictícia começa com previsão de **1 período exato de 24 horas**.
- O servidor calcula `plannedUntil = entryAt + plannedDays × 24h` independentemente do relógio do celular/navegador.
- Enquanto não há saída, um registro que ultrapassa o fim da previsão aparece em `needs_review`. É **alerta operacional**, não dívida nem cobrança.
- O ADM Turismo pode filtrar por todos, sem saída, previsão ultrapassada e encerrados.
- Ampliação exclusiva do `admin-turismo` no município correto, de 1 a 30 períodos por pedido, total máximo de 90; sempre com revisão otimista e UUID idempotente.
- Histórico de evento `extended` preserva revisões; sem expor identidade funcional no retorno público.
- Proteção SQL `SECURITY DEFINER`, execução restrita a `jeriflow_app`, sem CRUD direto de tabelas.
- Testes unitários, cenários PostgreSQL e testes de navegador em ambiente isolado.

## Não implementado
- Nenhum valor de diária é aplicado. O preço histórico de R$40 na V5.16 **não está aprovado** para produção.
- Nenhum cálculo de dívida, multa, saída em aberto financeira, `paidUntil`, comprovante, pagamento, Pix/cartão ou voucher.
- Nenhum cadastro de autorização oficial, titular real, controle de vaga, integração TTS ou transporte.
- Não há descarte LGPD aprovado, implantação em VPS exclusivo JeriFlow, APK/IPA homologado ou validação com dados verdadeiros.

A regra correta de negócios será separar `plannedUntil` (previsão) de um futuro
`paidUntil` (período efetivamente **quitado e validado por fonte autorizada**). Não
copiar `plannedUntil` para `paidUntil` por inferência.

## Itens da lista mestre afetados
- JF-083 (24 horas): implementação parcial **sem tarifa**.
- JF-087 e JF-092 (pendências): somente **sinalização de prazo previsto**.
- JF-088 (extensões): ampliação de previsão simulada, sem cobrança.
- JF-078–086: cadastro e saída ainda em fase de homologação.

## Próxima prioridade
1. Homologar esta fase no HEAD e revisar PRs #7, #8, #9, #10, #11.
2. Formalizar com autoridade competente o valor da diária, tolerância, regras de pagamento, estorno, cancelamento e perfis excepcionais.
3. Desenhar ledger/registro de pagamentos aprovado, persistente e auditável, separado do planejamento.
4. Implementar vouchers oficiais somente com base comprovadamente autorizada.
5. Revisar privacidade, segurança do repositório e instalação em dispositivos físicos antes de piloto.

**Não mesclar automaticamente.** A PR #6 tem migrações 011–013 conflitantes.
`main` e a VPS do Ramo Nessa permanecem fora do escopo.
