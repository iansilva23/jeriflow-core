# JeriFlow — Ouvidoria / Protocolos (primeira fatia operacional)

**Status em 08/10/2026:** desenvolvimento em branch isolada `feature/ouvidoria-protocolos-20261008`. **Não liberado para produção, VPS ou dados pessoais reais.**

## O que foi adicionado
- Migração aditiva `004-ouvidoria-protocols.sql`, sem reescrever 001–003 nem apagar volumes.
- Protocolos associados a **um município e um cidadão autenticado**: categoria `denuncia`, `reclamacao`, `solicitacao` ou `sugestao`, título e descrição.
- Identificador `clientRequestId` obrigatório para criação idempotente por cidadão/município.
- Listagem paginada: `meus` acessível somente ao próprio autor com perfil Cidadão ativo; `fila` acessível somente ao Admin Cidadão/Ouvidoria no município.
- Alterações com revisão otimista: `open → in_review → responded → contested → responded → closed` (algumas transições podem pular a análise). Uma contestação por protocolo nesta versão.
- Eventos de auditoria com ator, município, ID da requisição, tipo e revisão. Não é permitido CRUD direto das tabelas pelo papel de API.
- Auth compartilhado existente, com sessão, email verificado e MFA obrigatório no perfil administrativo. A autorização é revalidada dentro de cada função SQL, não apenas no aplicativo.

## Contrato HTTP (somente desenvolvimento local)
Ambas as rotas usam **POST**, JSON, token Bearer em `Authorization` e recusam `Origin` web externo:
- `/api/v1/ouvidoria/query`: `{"municipalityId":"<uuid>","scope":"meus|fila","after":"<uuid opcional>"}`. Resposta: `{"items":[...],"next":"<uuid|null>"}`, até 20 registros.
- `/api/v1/ouvidoria/mutate`: operação `create` com `municipalityId,clientRequestId,category,title,description`; `triage`, `respond`, `contest`, `close` com `municipalityId,protocolId,revision`; `respond` e `contest` exigem também `message`.
- Retorno das mutações: `{"protocolId":"<uuid>","status":"<status>","revision":<inteiro>}`.
- Validação: texto controlado, limites de tamanho, nenhum campo inesperado ou promoção de privilégios. Recusa 401 de sessão inválida, 403 de falta de perfil/MFA, 404 de item indisponível, 409 para revisão obsoleta ou transição inválida.

## Critérios de validação
- `npm run check`: tipos TypeScript e testes unitários/regras de entrada.
- `npm run identity:verify`: regressão do Bloco 4 com PostgreSQL, Redis e Mailpit reais.
- `node --test tests/integration/ouvidoria.test.mjs`: criação, idempotência, duas cidades isoladas, MFA admin, status, contestação, revisão, leitura protegida e auditoria em PostgreSQL real.
- GitHub Actions em branch de feature: `.github/workflows/ouvidoria.yml`.

## O que AINDA FALTA
- Tela funcional no app Cidadão e no painel Ouvidoria, incluindo acompanhamento e interface de resposta.
- Fotos/anexos em armazenamento privado, com regras de tamanho, tipo, varredura de malware e autorização de acesso.
- Histórico de eventos exposto à UI mediante regras de perfil, notificações, canais externos e gestão de SLA.
- Regras operacionais institucionais de sigilo de denúncias, níveis de acesso, moderação, retenção, exportação e exercício de direitos LGPD.
- Testes com interfaces Android/iOS e navegador real; homologação VPS isolado HTTPS, backup/restore e observabilidade.
- A emissão de protocolo **não é anônima** nesta versão; não afirmar garantia de anonimato. Nenhuma integração oficial ou processamento de dados reais foi habilitado.

**Observação:** este é o início de um módulo operacional, não um produto finalizado. O `/health/ready` continua intencionalmente em 503.

## Interface inicial conectada — 09/10/2026
- App **Cidadão**: escolher município autorizado, cadastrar protocolo com `clientRequestId` por tentativa, listar protocolos pessoais, acompanhar status/resposta e enviar a primeira contestação permitida. Falha de rede na escrita não dispara repetição automática; usar o mesmo identificador ao reenviar a criação pendente.
- **Admin Cidadão/Ouvidoria**: link no painel municipal autenticado, fila exclusiva ao município autorizado, ações `triage`, `respond` e `close`, confirmação de revisão atual e atualização da fila.
- Painel Next usa o mesmo **BFF restrito** por cookie HttpOnly, cabeçalho de origem e proteção CSRF. O Bearer não chega ao JavaScript do navegador. O app reutiliza sessão no armazenamento seguro já existente.
- A tela e o serviço não suportam fotos, contestações administrativas, anexos, chat nem anonimato de denúncia nesta fatia. Sigilo de relatos e LGPD institucional dependem de política de acesso mais granular; **não ativar com denúncias reais**.
- Verificações: tipos dos apps e painel, build Next, testes do BFF, contrato, integração com bancos reais e regressões de identidade. Os resultados devem ser citados pelo ID real da execução antes de aprovar esta etapa.

## Histórico auditável — implementação 09/10/2026
- Migração aditiva `005-ouvidoria-history.sql`, função restrita `app.ouvidoria_history`.
- Contrato `POST /api/v1/ouvidoria/history` com `municipalityId` e `protocolId`: retorna somente `code`, `revision` e `createdAt` por evento. Não inclui email, ator ou payload interno.
- Cidadão consulta apenas protocolos próprios, enquanto Admin Cidadão/Ouvidoria consulta os do município autorizado; vínculo revogado deixa de autorizar. Retorno 404 oculta existência para outras contas.
- Botão **Ver histórico** no app Cidadão e no painel administrativo, sem alterar o status nem criar novos eventos.
- Regressões integradas, de contrato e navegador testam cronologia, leitura negada e conteúdo mínimo. Sem dados reais ou autorização de produção.
