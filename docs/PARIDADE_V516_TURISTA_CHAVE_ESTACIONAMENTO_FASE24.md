# JeriFlow V5.16 — Fase 24: chave de acesso ao estacionamento do App Turista

## Referência suprema e preservação

Antes de criar os arquivos foram relidos do ZIP original V5.16 SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`: `admin-turismo/index.html` `makeParkingToken()`, `showAccessToken()`, `printParkingVoucher()`; `turista/index.html` `validateParkingToken()`, `activateParkingToken()`, `isLinkedParkingActive()`, `saveParkingTokenHistory()` (até 5 recentes), `maskParkingToken()`. Também foram verificados no GitHub todos os arquivos de destino para confirmar que não existiam. Nenhuma funcionalidade existente foi substituída, e não foi reutilizada a migração antiga de fila `017-parking-service-requests.sql`.

## Implementação privada (não operacional em servidor público)

- **Migração 022:** chave vinculada à matrícula de estacionamento real da 020, isolada por município. O operador administrativo com MFA a emite após cadastro e a pode reimprimir ou revogar. A emissão/rotação/reimpressão/revogação têm histórico de auditoria. Role API não recebe SELECT nas tabelas.
- **Serviço `ParkingAccessServiceV516`:** token aleatório `JFPK-` com 26 caracteres de alfabeto legível (~130 bits), hash SHA-256 para validação e criptografia AES-256-GCM com chave de 32 bytes fornecida pelo ambiente para poder reimprimir vouchers autorizados. Banco não armazena token em texto claro. Teste de integridade do tag/AAD antes de reimprimir.
- Chave só é válida **após a entrada física ter começado e enquanto a saída REAL não for registrada**, inclusive se o período pago estiver vencido. A TTS continua independente: apresentar voucher não comprova taxa oficial, nem emite autorização de Fiscal.
- Histórico de no máximo **5 chaves locais no dispositivo** permanece regra da V5.16. Este trabalho cria o backend de validação de um token, mas NÃO implementa nem altera a UI de 5 recentes no React Native.
- Validação retorna apenas dados mínimos da estadia que quem possui a chave pode consultar; não inclui documento, telefone nem outras pessoas. Reimpressão requer sessão administrativa original e chave AES. Token revogado ou encerrado é negado indistintamente do inexistente.
- Testes PostgreSQL 17 reais: emissão, criptografia/hasheamento, reimpressão, invalidação por outra chave AES, revogação/rotação, diferenciação de município e role, revogação ao término da estadia, token de estadia com vencimento financeiro mas ainda fisicamente presente.

## Bloqueios antes da utilização real

- **Não existe rota HTTP pública** nesta PR. Antes de expor verificação de tokens, implementar limites distribuídos por IP/token, proteção contra enumeração, logs privados, testes de carga e autenticação administrativa HTTP real.
- **Gerenciamento da chave AES:** segredo deve ser fornecido por gerenciador seguro, com backup, rotação e política de recuperação. Perder o segredo impede reimpressão de vouchers anteriores. Não usar valores de exemplo como chave em produção.
- Fluxo do voucher PDF/impressão, App Turista RN, cadastro de até 5 recentes, ativação, esquecimento, chat/transporte, autorização TTS oficial, aprovação de tarifas e homologação em aparelho físico ainda pendentes.
- Ainda é preciso integrar todas as PRs da Ouvidoria/Guarda e Turismo sem sobrescrever migrações 004–017, executar migração real planejada e aprovar regras financeiras institucionais.

**Base:** PR #38 HEAD `dec4bd24856505a3b750964578ef7b51a2d3cf0c`, nova PR DRAFT. `main`, VPS, API pública e HTML V5.16 seguem intocados.
