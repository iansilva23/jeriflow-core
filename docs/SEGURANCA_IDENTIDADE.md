# Identidade — confirmação, recuperação e segundo fator

Bloco 2 implementado. Validação integrada desta revisão: pendente até registrar
execução aprovada. Desenvolvimento local, sem autorização para produção.
Os nomes dos quatro apps e dos sete painéis não foram alterados.

## Comportamento

- Toda conta, inclusive uma já existente, começa sem email comprovado. Nenhum
  município ou privilégio é liberado antes de confirmar o endereço recebido.
- Todos os perfis `admin-*` e o Mestre exigem segundo fator. Usuários móveis
  podem ativá-lo voluntariamente; depois de ativado também precisam comprová-lo.
- Login devolve `nextStep`: `email_verification`, `mfa_enrollment`,
  `mfa_challenge` ou `ready`. Sessão pendente dura dez minutos e não dá acesso
  operacional. `me` informa o próximo passo sem revelar permissões pendentes.
- Confirmação de email e redefinição de senha não fazem login automático:
  revogam as sessões anteriores. Recuperar a senha NÃO remove o MFA.
- Alteração de perfil é conferida a cada acesso. Promover cidadão a administrador
  não aproveita sua sessão sem segundo fator.

## Endpoints adicionais

Todos são POST JSON sob `/api/v1/auth`. Tokens e códigos só no corpo, nunca na
URL. Mesmas proteções HTTP, limites de corpo e política de origem do bloco 1.

| Caminho | Corpo | Autenticação |
|---|---|---|
| `/email/request` | `email` | Pública; resposta genérica |
| `/email/confirm` | `token` | Código recebido no email |
| `/password/request` | `email` | Pública; resposta genérica |
| `/password/reset` | `token`, `password` | Código recebido no email |
| `/mfa/enroll/start` | `password`, `code` se já há fator | Bearer + email confirmado |
| `/mfa/enroll/confirm` | `code` do novo autenticador | Mesmo Bearer do início |
| `/mfa/challenge` | `code` TOTP ou recuperação | Bearer pendente, senha comprovada há menos de 10 min |
| `/mfa/recovery-codes` | `password`, `code` atual | Bearer completo + nova prova de ambos |

O cadastro devolve segredo Base32 e URI `otpauth` para o autenticador. Confirmar
o primeiro código ativa o fator, troca o token de sessão e devolve dez códigos
de recuperação, exibidos uma única vez. A tela futura deve pedir que a pessoa
os guarde fora do celular. Substituir autenticador exige senha e fator anterior
(ou um código de recuperação), mantendo o fator antigo até confirmar o novo.
Não existe rota para desligar MFA ou removê-lo por email.

## Proteções e limites

- Código de email: 256 bits aleatórios, SHA-256 no registro de validação,
  finalidade separada, 30 minutos, uso único. Reenvio substitui o anterior.
  Consumo concorrente é serializado no banco. Alterar senha/email/estado da
  conta invalida códigos anteriores pelo `auth_version`.
- Pedidos públicos retornam a mesma resposta para email inexistente, confirmado,
  bloqueado ou limitado. Envio em fila e piso de 250–300 ms reduzem diferenças
  de tempo; não se promete indistinguibilidade temporal sob qualquer carga.
- Limites Redis por 15 minutos: login 10/conta e 60/IP; email 5/endereço e 60/IP;
  consumo de email 5/token e 60/IP; MFA 10/usuário e 60/IP. Falha do Redis nega
  a operação. IP vem da conexão, não de `X-Forwarded-For` não confiável.
- TOTP RFC 6238, HMAC-SHA-1, seis dígitos, 30 segundos, tolerância de um período
  em cada direção. Último período aceito fica no banco; nem outra instância
  pode reutilizá-lo. Isso não é proteção contra phishing em tempo real.
- Dez códigos de recuperação de 128 bits, hashes vinculados ao usuário, uso
  único e consumo atômico. Renovar exige senha + fator e revoga outras sessões.
- Segredo TOTP e conteúdo pendente de email cifrados com AES-256-GCM; nonce
  aleatório e autenticação do usuário/finalidade impedem troca entre registros.
- A chave fica em `.secrets/identity-key`, privada, fora do banco e do Git.
  Migração confere sua impressão digital. Chave ausente após instalação ou
  divergente interrompe a operação; não se regenera uma chave substituta.
- API pode atualizar somente colunas de credenciais explicitamente concedidas;
  não cria usuários nem promove perfis. Auditoria continua somente inserção.
  Esse isolamento não protege de comprometimento completo do serviço de identidade.

## Email local e operação

1. `npm run infra:up`: PostgreSQL, Redis e Mailpit somente em loopback.
2. `npm run identity:migrate`: aplica migrações aditivas, preserva checksums e
   inicializa a chave uma única vez. Guardar banco E chave em backup protegido.
3. `npm run dev:api`: API local e worker que processa a fila a cada cinco segundos.
4. Caixa de teste: `http://127.0.0.1:58025`. Não usar dados reais nesta caixa.
5. `npm run identity:verify`: cenários isolados com bancos e email reais locais.

A caixa captura mensagens pela API HTTP do Mailpit, sem relay/encaminhamento.
Não são enviados emails externos. Não há links de recuperação para uma tela
inexistente: nesta fase o email contém um código opaco para a futura tela/API.
Metadados da fila persistem no PostgreSQL; conteúdo fica cifrado. Worker usa
bloqueio por mensagem, lotes de dez, prazo de dois segundos por entrega e no
máximo cinco tentativas espaçadas. Falha não elimina a mensagem; depois do
limite fica pendente até vencer (30 min), e um novo pedido gera novo código.
A entrega é ao menos uma vez: queda entre envio e commit pode duplicar email,
mas nunca torna um código consumido reutilizável.

## Critério de fechamento e próxima integração

O bloco só será aprovado após tipos/testes locais e cenários em PostgreSQL,
Redis e Mailpit passarem. Isso não encerra todo o backend e não prova entrega
em Gmail/iCloud nem login nas telas dos apps/painéis, ainda não conectadas.

Próximo bloco: telas de autenticação, armazenamento seguro móvel e sessão do
administrativo com cookie HttpOnly. Antes de acesso externo: selecionar e
validar provedor de email, domínio/remetente, TLS, gestão de chaves/backup,
observabilidade, política de recuperação assistida quando TODOS os fatores
forem perdidos e testes com aparelhos reais. Nenhuma remoção manual de MFA é
autorizada por este documento. Sem fatores, a conta permanece bloqueada até
um procedimento formal e seguro ser aprovado; email sozinho não basta.

Referências: [OWASP recuperação](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html),
[OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html),
[RFC 6238](https://www.rfc-editor.org/rfc/rfc6238.html),
[Mailpit API](https://mailpit.axllent.org/docs/api-v1/).
