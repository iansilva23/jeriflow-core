# JeriFlow — V5.16 Fase 8: cadastro/login do Cidadão fiel ao HTML, em PostgreSQL

**Fonte única aberta ANTES do código:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad` — ZIP sem erros de CRC.

## Comparação explícita

| Fonte original | Comportamento original | Implementação técnica nesta branch |
|---|---|---|
| `cidadao-ai/index.html` #citizenSignupName, #citizenSignupBirth, #citizenSignupPhone, #citizenSignupAddress, #citizenSignupLogin, #citizenSignupPassword, #citizenSignupPassword2 | Nome completo, nascimento, telefone, referência na Vila, login e senha/confirmar; mínimo **8 caracteres** | `apps/api/src/citizen-accounts-v516.ts` `signup()`, sem e-mail nem código extra |
| `citizenNorm()` | NFD remove acentos, minúsculas e símbolos substituídos por pontos | `normalizeCitizenLoginV516()` com o algoritmo idêntico |
| `citizenSignup()` | Cadastro **imediato**, login único, cria ID `CID-` + 8 dígitos e mantém sessão ativa | `app.citizen_v516_register` mais `app.citizen_v516_issue` na mesma transação; ID legível `CID-` e 8+ dígitos de sequência confiável; nunca devolver sessão de transação abortada |
| `citizenLogin()` | Login/senha; senha errada negada; proíbe login com bloqueio ativo | `login()` valida scrypt com comparação constante; recusa erro igual para login inexistente, senha errada e conta bloqueada |
| `currentCitizen()`, `applyCitizenSession()` | Cadastro recupera nome, nascimento, telefone, referência e login | `citizen_v516_resolve` consulta sessão real + estado administrativo; `resolveSession()` se conecta ao contrato da PR #22 |
| `citizenModerationState()`, `shared/jeriflow-moderation.js` `effectiveStatus()` | Advertência não bloqueia, banimento bloqueia, suspensão bloqueia até expirar; login OU telefone prévios bloqueiam novo cadastro | Colunas internas de moderação, cheque por login/telefone, status e `suspended_until` |
| `citizenLogout()` | Sair limpa sessão | `citizen_v516_logout` invalida o token do servidor |

## Segurança sem desviar UX

- O cadastro original armazena um hash local SHA-256, mas o **backend** usa hash de senha scrypt com sal aleatório (não muda a entrada do usuário). Tokens de sessão aleatórios de 256 bits são armazenados somente como SHA-256.
- A base genérica `app.identity_users` que exige e-mail **não foi modificada**. As tabelas técnicas específicas `app.citizen_v516_accounts` e `app.citizen_v516_sessions` são necessárias porque o HTML não exige e-mail.
- As tabelas e sequências são inacessíveis diretamente a `jeriflow_app`: acesso ocorre somente por funções `SECURITY DEFINER`. Banco aplica restrição de município e moderação; expiração absoluta (8h) e por inatividade (15m) são proteções técnicas, não campos novos.
- Em produção, o endpoint HTTP **deverá** usar limitador de tentativas compartilhado, HTTPS, cookies/armazenamento seguro e controle de sessão. **Nenhum endpoint foi criado aqui.**
- A migração é aditiva e de uso local/teste nesta PR. Não foi aplicada a servidores existentes. Workflow executa PostgreSQL efêmero com contas e credenciais explicitamente fictícias e sem dados pessoais.

## Limites que impedem homologação do produto

Esta PR **não** oferece UI de cadastro/entrar React Native conectada, recuperação de contas antigas do localStorage, portabilidade automática de hash fraco, integração administrativa de moderação, visitante com `deviceId`, upload HTTP, protocolo canônico PostgreSQL, autorização Guarda/SEMUS E2E, scanner ClamAV real ou execução em dispositivo físico.

O `CitizenV516Auth` é **biblioteca interna**. Testes e TypeScript demonstram somente os cenários executados, não a paridade completa do produto. O avanço seguinte deve criar **uma única** fonte de protocolos com foto efetivamente validada e autorizada, mantendo Guarda e SEMUS ligados ao mesmo ID; só depois integrar telas, respeitando a V5.16.

Branch em cima da PR #22; manter DRAFT; sem merge, VPS, produção, Ramo Nessa ou alteração de contas existentes.
