# JeriFlow — Estacionamento: primeiro cadastro de entradas e saídas

**Base:** PR #9 (`feature/turismo-estacionamento-solicitacoes-20261010`).
**Auditoria V5.16:** JF-079, JF-081, JF-082, JF-085, JF-086 — **parcial**, em homologação.

## Entregue nesta branch

- Migração aditiva `018-parking-entry-drafts.sql` (não altera 001–017).
- Apenas usuário com `admin-turismo` ativo do próprio município cria, lista, encerra e consulta histórico dos registros.
- Cadastra placa, marca, modelo, área e hospedagem opcional; usa relógio do servidor para entrada e saída.
- Registro presente só é liberado por **saída explícita**; nenhuma previsão causa baixa automática.
- Índice único impede duas entradas abertas da mesma placa no mesmo município.
- Idempotência por autor, município e identificador do cliente; revisão otimista na saída.
- Eventos de entrada e saída são gravados em PostgreSQL, sem identidade do servidor na resposta de histórico.
- Interface web administrativa em `/paineis/turismo/estacionamento/entradas`.
- Testes de payload fechado e integração com PostgreSQL real para autorização e concorrência lógica.

## Limites obrigatórios

**Tudo nesta etapa é simulado/experimental; use apenas dados fictícios.**
Não há autorização municipal oficial, controle de vagas, diária, cobrança, Pix, cartão,
voucher, número de ticket oficial, TTS, operação pública ou permissão de acesso ao local.
O aplicativo Turista mantém a fila de solicitações da PR #9, **separada** destes registros.
O modelo não inclui responsável/turistas nem documento pessoal até decisões de LGPD.
O relógio marca a **hora do registro no servidor**, que não pode ser retroativa nessa fase.

## Próximas etapas da lista mestre

1. Definir configuração municipal da diária por 24 horas, hora de corte e forma de pagamento.
2. Extensões, pendência após `pagoAté`, fechamento real e tolerância com motivo.
3. Pessoas/turistas e credenciais de vínculo sem expor dados sensíveis indevidamente.
4. Voucher verificável e administração de estornos, somente com autorização institucional.
5. Teste visual em navegador e dispositivos físicos antes de qualquer uso real.

**Integração:** revisar PRs #7 → #8 → #9 → esta branch, sem mesclar a PR #6 divergente.
`main` permanece intacta. VPS do Ramo Nessa não deve ser utilizada.
