# Núcleo de identidade — primeiro bloco do backend

Etapa 2 concluída como base técnica. Este bloco inicia o backend operacional,
em desenvolvimento local e CI com dados fictícios. Produção continua bloqueada.
Status em 19/09/2026: PRIMEIRO BLOCO APROVADO no ambiente de desenvolvimento.

[Execução 35411601261](https://github.com/iansilva23/jeriflow-core/actions/runs/35411601261),
commit `e8609562c5a8de8d15b33fa7b96aaaa395ebc689`: instalação pelo lockfile,
TypeScript, 56 testes de código e 12 cenários de integração aprovados na
primeira tentativa. O relatório TAP conta 13 testes incluindo o grupo externo.
PostgreSQL/Redis reais, duas instâncias da API, fixtures removidas e serviços
encerrados com sucesso. Relatório original e metadados estão em
`evidence/identity-35411601261/report.json` e `evidence/github-identity-35411601261.json`.
ZIP SHA-256: `1509545e9fd8502005410a6e5a8254d187f739efe8419b25caa43acdbada0274`.

Casos aprovados: migração repetida e checksum; recusa de credenciais e campos
de privilégio; sessão compartilhada e token protegido; isolamento municipal;
RLS e permissões do usuário do banco; Fiscal/TTS/Mestre separados; revogação
de perfil e município; logout e logout-all; expiração, inatividade, mudança
de senha e bloqueio; limite compartilhado de tentativas; falhas reais de
autenticação nos bancos; cadastro duplicado e auditoria das recusas.

A etapa completa do backend segue em andamento. O bloco seguinte, de email,
recuperação e MFA, também foi aprovado: veja [SEGURANCA_IDENTIDADE.md](SEGURANCA_IDENTIDADE.md).
As evidências deste documento acima são históricas do primeiro bloco.

## Implementado

- Usuários, municípios e vínculos de perfis em PostgreSQL, com migração versionada,
  checksum, transação e exclusão mútua. Reexecutar não recria nem apaga tabelas.
- Provisionamento local controlado por operador com credencial separada do banco.
  Não há senha padrão, endpoint público de criação de administrador ou sobrescrita
  de conta existente. Email duplicado recusa a operação inteira.
- Senhas scrypt com salt aleatório de 16 bytes, N=131072, r=8, p=1. Senhas de 15
  a 128 caracteres, sem truncamento ou remoção de espaços. No máximo dois hashes
  simultâneos por processo; excesso retorna indisponibilidade temporária.
- Sessões opacas aleatórias de 32 bytes, armazenadas somente pelo hash SHA-256;
  duração absoluta de oito horas e expiração após 15 minutos de inatividade.
  Logout revoga a sessão; logout-all revoga sessões existentes da conta.
  Troca da senha ou alteração de atividade incrementa a versão de autenticação
  no banco e invalida sessões anteriores. Emissão limitada a dez sessões por conta.
- Limite atômico no Redis: dez tentativas por email e 60 por IP em 15 minutos.
  Identificadores das chaves usam hash, que não deve ser considerado anonimização.
  O IP vem do socket; cabeçalhos encaminhados não são confiados nesta configuração.
  Redis indisponível impede login. Contas inexistentes e senhas erradas retornam
  o mesmo erro e executam o mesmo custo de derivação de senha.
- Permissões explícitas consultadas a cada acesso; RLS limita municípios e vínculos
  ao usuário autenticado. Contexto é local à transação, sem herança entre conexões.
  A API lê credenciais globais para autenticar, mas não pode cadastrar usuários,
  conceder perfis ou editar privilégios. Não é isolamento contra comprometimento
  do serviço de autenticação inteiro; a implantação requer credenciais protegidas.
- Auditoria de provisionamento, login, recusa de acesso e logout. API só insere
  eventos: não lê, edita ou apaga essa trilha. Não registra senhas, tokens ou emails.
- JSON limitado a 8 KiB, prazo de leitura, limites de conexões de banco e de
  operações concorrentes. Erros não devolvem URLs ou senhas do banco.

## Matriz inicial de entrada nos módulos

| Perfil atribuído | Acesso concedido |
| --- | --- |
| cidadao | App Cidadão |
| turista | App Turista |
| guarda | App Guarda/SEMUS |
| fiscal-tts | App Fiscal TTS |
| admin-turismo | Painel Turismo |
| admin-cidadao | Painel Cidadão/Ouvidoria |
| admin-semus | Painel SEMUS |
| admin-conteudo | Painel Conteúdo |
| admin-dashboard | Painel Dashboard |
| admin-studio | Painel Studio |
| admin-tts | Entrada no painel Turismo e área administrativa TTS |
| platformAdmin, somente provisionamento controlado | Entrada no Mestre global |

Os perfis municipais valem apenas no município do vínculo. Mestre não recebe
permissão implícita de acessar todos os dados municipais. Fiscal TTS não administra
a TTS. Entrar em um módulo não autoriza automaticamente todas as operações nele.
Os comandos operacionais serão autorizados no próprio backend ao serem implementados.
TTS manual por comprovante, autorização e token permanece o escopo; nenhuma
integração oficial ou regra tributária foi acrescentada.

## Endpoints disponíveis no ambiente local

| Método e caminho | Entrada / resultado |
| --- | --- |
| POST /api/v1/auth/login | JSON email e password; retorna Bearer, vencimento e prazo de inatividade |
| GET /api/v1/auth/me | Bearer; retorna o próprio usuário, municípios e permissões atuais |
| GET /api/v1/access | Bearer; permission e municipalityId quando municipal; 200 ou 403 |
| POST /api/v1/auth/logout | Bearer e JSON vazio; revoga a sessão |
| POST /api/v1/auth/logout-all | Bearer e JSON vazio; revoga as sessões existentes |

Token é aceito somente no cabeçalho Authorization. Não usar token em URL ou
localStorage. Chamadas com Origin são recusadas nesta API local; a integração
web será por servidor e cookie HttpOnly. Não foi habilitado CORS irrestrito.
As demais rotas de negócio continuam NOT_IMPLEMENTED. /health/ready permanece
503 porque o produto ainda não está pronto. A API escuta apenas 127.0.0.1.

## Execução para desenvolvimento

1. `npm run setup`
2. `npm run infra:up`
3. `npm run identity:migrate`
4. `npm run identity:verify`
5. `npm run dev:api`

O workflow manual `Identidade e isolamento entre municipios` executa a validação
sem compilar aplicativos novamente. PostgreSQL e Redis são temporários no CI.
Os testes criam contas em example.invalid, removem apenas os próprios registros
e usam um namespace Redis exclusivo. O relatório registra commit e resultado real.

Para provisionar uma conta de desenvolvimento, o operador prepara um JSON privado
(arquivo regular, modo 0600, até 16 KiB) contendo email, password, displayName,
platformAdmin opcional e municipalities. Cada município possui slug, displayName
e roles conforme a tabela acima. Execute `npm run identity:provision -- caminho`.
O assistente faz os testes com contas fictícias; o responsável não precisa preparar
esse arquivo nem enviar credenciais no chat. O arquivo privado deve ser removido
com segurança após uso pelo operador. Nenhuma credencial entra no repositório.

## Limites deste bloco e sequência dentro da etapa do backend

As telas de autenticação foram conectadas no bloco 3; configuração e evidências
estão em [TELAS_AUTENTICACAO.md](TELAS_AUTENTICACAO.md). Cadastro público e gestão
de usuários por painel ainda não foram implementados.
Confirmação de email, recuperação de senha e MFA foram aprovados no bloco 2,
somente no ambiente de testes descrito no documento complementar. Provisionamento
continua sendo uma ferramenta de desenvolvimento, não o cadastro público definitivo.
Antes de liberar dados reais, concluir gestão de perfis, operações e homologação
do ambiente externo, conforme os limites do documento do bloco 3.
Depois vêm as operações de negócio. Dispositivos físicos, entrega de emails,
armazenamento seguro de tokens nos celulares, TLS, proxy confiável, retenção da
auditoria, backup/restauração, carga e operação em nuvem têm seus próprios testes.
Não há contratação de infraestrutura nem capacidade de produção declarada aqui.

## Bloco 2 — evolução desta base

Confirmação de email, recuperação de senha e MFA foram aprovados na execução
35439956964; sua validação e seus limites são acompanhados em
[SEGURANCA_IDENTIDADE.md](SEGURANCA_IDENTIDADE.md). As evidências acima permanecem
as do bloco 1 e não devem ser usadas para declarar os fluxos novos aprovados.

## Referências

- [OWASP — armazenamento de senhas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP — gerenciamento de sessões](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [PostgreSQL — políticas por linha](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
