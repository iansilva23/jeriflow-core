# JeriFlow — Trilha persistente de conciliação ARTIFICIAL

**Base:** PR #13 (reconciliador em memória). **Migração:** `021-parking-reconciliation-lab.sql`.
**Ambiente:** somente desenvolvimento isolado, com amostras fictícias.

## O que esta etapa realiza

- Cria casos e eventos de laboratório de conciliação em PostgreSQL com chaves de idempotência e histórico somente aditivo para a conta da API.
- Cada caso pertence a um município e a um autor; referencia um `order_key` gerado para simulação, sem associação com turismo real, placa, pessoa, PSP, diária quitada ou cliente.
- Eventos têm identificador global por município, referência com prefixo obrigatório `TEST_`, tipo `sample_confirmation`, `sample_refund` ou `sample_chargeback` e valor artificial em centavos.
- Duplicidade idêntica é segura; reutilização do ID com conteúdo diferente ou referência repetida é recusada.
- Funções `SECURITY DEFINER` confirmam sessão/MFA e vínculo ativo `admin-turismo` ao município; API não possui CRUD direto nas tabelas.
- Consulta de um caso requer seu UUID e município, retorna apenas os dados sintéticos e eventos, sem expor identidade do operador. Não há endpoint de busca geral.
- Interface de desenvolvimento do Admin Turismo permite criar um caso de R$ 80 fictícios, salvar e recuperar eventos artificiais.
- Testes de payload, exclusividade do município, revogação de perfil, idempotência, conflito e consultas em PostgreSQL real, mais regressão no navegador.

## Contrato inegociável

`testOnly:true`, `financialEffectsEnabled:false`, `paymentRegistered:false`,
`authorizationIssued:false`, `voucherIssued:false`, `debtCreated:false`,
`paidUntil:null` sempre presentes. Esses campos são invariantes fixas da API.

**Este módulo não aceita webhook, assinatura de PSP, credenciais, comprovantes, cobranças, pagamentos reais, estornos reais ou cadastro de turistas.** Todas as referências começam com `TEST_` por restrição do banco e validador. `sample_confirmation` **não comprova pagamento**.

A imutabilidade é garantida a nível da conta da aplicação (tabelas sem DML para `jeriflow_app`, apenas funções de inserção e leitura). O proprietário do banco mantém acesso de manutenção para apagar *somente fixtures* dos testes, portanto não significa trilha legal imutável pronta para operação financeira.

## Próximas etapas reais, dependentes de decisões

1. Definir tarifa e período legal de diária, valores de isenções, titular da cobrança e termos contratuais.
2. Escolher PSP adequado ao município, validar credenciais e assinaturas conforme documentação atualizada.
3. Criar ordens com valores imutáveis e referência criptográfica ao PSP, seguindo regras institucionais aprovadas.
4. Elaborar inbox de webhook assinado, idempotência e reconciliação com uma fonte de verdade do provedor.
5. Implementar compensações, reembolso, contestação, tolerâncias, erro de rede e reconciliação contábil.
6. Homologar com pagamentos **de teste do PSP**, não com a estrutura artificial deste arquivo.
7. Realizar avaliação LGPD e revisão de segurança e instalar apps em dispositivos físicos.

**Sem merge/deploy automático.** PR #7→#8→#9→#10→#11→#12→#13→nova PR. PR #6 contém migrações concorrentes e exige conciliação técnica. `main` permanece intacta, aplicativos em React Native e VPS Ramo Nessa não utilizada. Repositório permanece público por decisão do proprietário: não versionar segredos nem dados pessoais.
