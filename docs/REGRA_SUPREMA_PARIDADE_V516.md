# REGRA SUPREMA — PARIDADE TOTAL COM A V5.16 HTML

> **Regra do proprietário (10/10/2026):** NUNCA criar, modificar, remover, recomendar ou integrar uma funcionalidade do JeriFlow sem primeiro localizar o comportamento correspondente no pacote HTML original **V5.16**. A V5.16 é a referência obrigatória de funcionalidades, telas, campos, permissões, cálculos e processos. Não criar funcionalidades extras nem substituir processos aprovados.
>
> Melhorias internas necessárias a segurança, integridade, banco PostgreSQL, autenticação, API, acessibilidade ou operação Android/iOS devem **preservar exatamente o comportamento funcional**. Mudança de requisito exige autorização explícita do proprietário.

## Artefato de referência primária

`JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`

SHA-256 do arquivo ZIP entregue:
`89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`.

O arquivo ZIP é o documento-fonte; **não** usar esta nota como substituto do HTML. O pacote inclui `admin-turismo/index.html` e os demais apps/painéis. Consultar o próprio HTML/JS completo, guias e validações antes de cada mudança.

## Procedimento INEGOCIÁVEL antes de qualquer implementação

1. **ABRIR V5.16**: localizar o módulo, a tela, o formulário, a função JavaScript, os estados e as validações no ZIP original. Não inferir a partir do nome do módulo.
2. **MAPEAR**: anotar caminho do arquivo, IDs, nomes de função e regra exata, incluindo limites e exceções. Se a função não existe na V5.16, **NÃO IMPLEMENTAR**.
3. **COMPARAR**: conferir base `main`, PRs abertas e código real antes de criar qualquer branch ou alteração. Não refazer trabalho aprovado nem sobrescrever outro módulo.
4. **IMPLEMENTAR SOMENTE A EQUIVALÊNCIA**: conservar entradas, saídas, mensagens, papéis, fluxo, preços e condições do HTML. Usar tecnologias modernas apenas como suporte transparente.
5. **TESTAR A PARIDADE**: ensaiar casos bons, erros, permissões e sequências ponta a ponta contra o HTML; indicar o que é parcial, bloqueado ou pendente. Compilar não significa homologar.
6. **NÃO ADICIONAR SUPOSIÇÕES**: sem PSP, webhook, conciliação bancária, checkout, automações financeiras, tabelas extras visíveis, controles de preços não existentes, estados inventados ou limites arbitrários.
7. **BLOQUEAR DESVIOS**: toda proposta sem prova de correspondência direta à V5.16 fica fora da cadeia de integração. Se houver dúvida, preservar o código atual e suspender a novidade.

## Fonte funcional — ADM Gestão Turismo / Estacionamento

`admin-turismo/index.html`:

| Função na V5.16 | Local do HTML / JS | Regra obrigatória |
|---|---|---|
| Diária | linhas ~287, ~616, `PARKING_DAILY_RATE=40` | **R$ 40/24h** por diária, valor fixo no protótipo. Sem editor de tarifa |
| Cadastro | modal `regModal`, linhas ~453–527; `saveReg()` | Placa, marca, modelo, ano, data/hora de entrada, responsável, CPF/documento, contato, hospedagem, turistas, TTS e fotos |
| Pagamento na entrada | `rMethod`, `rPay`, `rReceiptPhoto`, `saveReg()` | Recebimento **declarado manualmente** por atendente; PIX/dinheiro/crédito/débito; comprovante opcional |
| Mais diárias antecipadas | `rMoreDays`, `rDays`, `rNoRefundAck`, `paidUntilDate()` | 1 diária padrão; múltiplas diárias mediante ciência de não reembolso por saída antecipada |
| `Pago até` | `paidUntilDate(r)`, linha ~621 | Entrada + **diárias registradas como pagas × 24h**; não é mera previsão ou confirmação de banco |
| Extensão | `extensionDailies`, `extensionMethod`, `saveExtension()`, ~1328–1333 | Registra nova diária/recebimento e estende o `Pago até`; não altera TTS |
| Vencimento/pendência | avisos ~287, ~326, `dueState()` e `renderDueAndPending()` | Veículo continua estacionado até saída física; não gera cobrança automática |
| Saída, tolerância | `confirmPhysicalExit()`, `confirmTolerance()` | Ato operacional explícito; tolerância requer justificativa e não cria receita |
| Exceção | `earlyExitModal`, `coordinatorDecisionModal`, `verifyCoordinatorAuthorization()` | Regra é sem reembolso antecipado; estorno excepcional somente coordenador/ADM Mestre e senha separada, para **devolução já realizada** |
| Voucher | `printParkingVoucher()` | Impressão/reimpressão e chave do turista; não depende de PSP |
| Financeiro | `paymentMovements()` | Soma os recebimentos e os estornos **registrados**, sem API bancária |

O HTML usa `localStorage` porque era protótipo; no novo produto somente a persistência pode mudar para serviços e banco protegidos, **sem alterar a regra**.

### Remediação do desvio de escopo detectado

- PR #9 criou atendimento genérico para solicitar estacionamento por placa/área/data, enquanto a V5.16 exige **transporte de retorno hospedagem → estacionamento**, vinculado a cadastro ativo e com ponto/foto/quantidade de passageiros/bagagem. **FORA DO ESCOPO**.
- PR #10 criou um registro de entrada/saída experimental com campos/horários diferentes do formulário V5.16, incluindo uma área obrigatória inexistente na ficha original; **FORA DO ESCOPO** até reconstrução fiel.
- PR #11 introduziu `plannedDays`, ampliação de previsão, máximo 90 e estado não financeiro, divergentes do processo real de **diárias pagas declaradas manualmente**.
- PR #12 introduziu editor de propostas de tarifa editável, inexistente no original.
- PR #13 introduziu simulador de conciliação com eventos típicos de PSP, inexistente no original.
- PR #14 introduziu persistência de eventos fictícios de conciliação, inexistente no original.
- PRs #9–#14 ficam **fora do desenvolvimento ativo**, fechadas e com seus ramos reais alinhados à base anterior. Seus commits originais só permanecem como histórico de auditoria. Não podem voltar à cadeia de merges sem novo mapeamento de equivalência.

**Regra permanente:** NÃO voltar a criar ou integrar PSP, gateway, webhook, simulação tarifária, conciliação financeira de provedores ou funcionalidades estranhas à V5.16 sem nova autorização expressa. Registro operacional manual do meio PIX **não significa** integração Pix API.

Qualquer futura evolução deve incluir uma seção `Correspondência V5.16` com arquivo, função, campos e provas de testes antes de revisão ou merge.
