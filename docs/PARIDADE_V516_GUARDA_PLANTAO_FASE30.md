# JeriFlow V5.16 — Etapa 30: disponibilidade persistente da Guarda

## A regra suprema foi executada antes de alterar

Fonte original ZIP `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`; `unzip -t` íntegro. Foi conferido `guarda-semus/index.html` (`let onShift=true`, botão `shiftBtn` que alterna **● EM SERVIÇO / ○ FORA DE SERVIÇO**, `publishGuardState`, `acceptReport`, `finishBtn`) e `shared/jeriflow-audit-guarda.js` (restauração local de `onShift=false`).

**Descoberta importante:** O HTML original usa a disponibilidade como informação de plantão, MAS **não** recusa assumir ou finalizar denúncia com `onShift=false`. A nova backend NÃO inventa essa restrição. Além disso, o valor padrão do HTML é `true`; o banco retorna **onShift=true** a um guarda autorizado sem marcação anterior.

## Preservação

PR #44 `6877006f0e8942b1e4c7c19520537556063390b3`: revisados `infra/migrations/024-citizen-v516-guard-service.sql` e `tests/integration/traffic-guard-service-v516.test.mjs` antes da mudança. A migração **025** foi ADICIONADA, sem editar nenhuma função 001–024. Os testes de atendimento anteriores foram preservados integralmente; a suite de integração foi estendida com novos cenários, em atualização por SHA do arquivo, não substituição indiscriminada.

## Implementado

- Tabela privada `guard_v516_shift_presence`: disponibilidade declarada por **guarda e município**, timestamp persistente.
- Tabela `guard_v516_shift_events`: histórico de cada alteração manual e seu UUID de requisição único.
- `guard_v516_shift_get`: consulta disponibilidade do próprio agente após autenticação completa, papel de Guarda e município ativo; retorna true por padrão.
- `guard_v516_shift_set`: persiste a intenção explícita true/false (não inverte o estado cegamente) e grava auditoria na mesma transação. UUID idempotente impede duplicidade; repetir operação antiga não desfaz alteração mais recente; conflitos entre agentes/valores são recusados.
- Row lock `FOR UPDATE` serializa alterações concorrentes por agente. O papel HTTP tem apenas EXECUTE das duas funções. Não tem SELECT/UPDATE das tabelas de plantão; roles de scanner e reconciliador não podem acessar as funções.
- A fila de Cidadão, o resultado do atendimento, os estados `RECEBIDA/EM ATENDIMENTO/FINALIZADA`, os protocolos e as permissões anteriores **não mudam**.

## Testes e limites

PostgreSQL 17 descartável, mesmas migrações 001–010 e 020–025, duas conexões concorrentes, funcionários fictícios com dois municípios. Além da regressão de aceitar/finalizar, validam-se ausência de registro como true, desligar/repetir, isolamento por agente, recuperação do status, duplicação conflitante, concorrência, ausência de restrição de atendimento não prevista na V5.16, sessão revogada, perfil estranho e sem acesso direto a PII.

**Não representa rastreamento de presença em tempo real:** sem heartbeat ou expiração automática, `onShift` é uma declaração persistida, não prova de agente conectado nem sua geolocalização. A API HTTP e a UI React Native ainda não chamam essas funções. Também faltam pedidos de apoio à central, sinalizações, avisos/notificações, fluxos de reabertura e homologação nos aparelhos. Não habilitar comportamento de produção com base somente nesses testes.

PR empilhada DRAFT, `main`/VPS/HTML original preservados, zero merge ou alterações nos outros projetos.
