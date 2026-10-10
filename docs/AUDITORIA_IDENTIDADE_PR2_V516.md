# Auditoria V5.16 — autenticação da base e PR #2

**Data:** 10/10/2026. **Fonte conferida:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`.

## V5.16 — fluxo original do usuário e ADM

- `admin-master/index.html`: tela `jfAuthGate` com `jfAuthLogin` rotulado **Login** (identificador escolhido), `jfAuthPassword` (**Senha**), cadastro com **Nome completo**, **Login desejado**, **Senha** e **Confirmar senha**.
- A própria tela orienta que a solicitação de cadastro será enviada ao Mestre e o acesso só funciona **após aprovação**.
- `guarda-semus/index.html` e `admin-cidadao/index.html` exibem formulários equivalentes de **Login** e **Senha**, e fluxo de inscrição com aprovação administrativa.
- `GUIA_PARA_PROGRAMADORES.md`, seção **Copiar dados de acesso — V5.0**: o ADM Mestre pode copiar acesso, resetar senha, e só incluir a senha temporária disponível na sessão corrente, nunca um hash.
- Comportamento interno de segurança deve proteger as credenciais sem expor hash ou chave em HTML público.

## Base atual em `main`

- `packages/mobile-auth/AuthApp.tsx` oferece login por **Email** e senha, registro inicial por e-mail/código, ativação por código, recuperação e MFA.
- `apps/admin/app/paineis/mestre/contas/panel.tsx` opera convite por e-mail e papéis por município; a ação `invite` exige e-mail e ativa fluxo de código.
- `packages/auth/client.ts` contém mensagens de e-mail obrigatório e senha de 15–128 caracteres, diferentes dos textos/campos do HTML (que indicam senha de 8+ caracteres na solicitação original).
- Algumas exigências adicionais (como MFA de administradores, sessōes protegidas, hash, validação de e-mail) podem ser **melhorias técnicas de segurança**, mas não são equivalência de UX nem podem ser consideradas fiéis sem discriminar o que altera as operações aprovadas.

### PR #2

- A PR #2 (`homologacao/bloco4-e2e-20260927`) altera somente um regex HTML de slug municipal, acrescenta teste de navegador com 43 controles e evidência de CI.
- Os 43 controles ensaiam, entre outros, **convite por e-mail, confirmação, MFA**, não o fluxo visual de **login escolhido → solicitação ao Mestre → aprovação** demonstrado pela V5.16.
- Resultados verdes na PR #2 podem comprovar consistência da **implementação atual**, mas **não sua paridade com a V5.16**.
- Não mesclar a PR #2 como "Bloco 4 homologado V5.16" enquanto o mapeamento de UX, credenciais, papéis e autorização não estiver concluído.

## Decisão técnica de segurança

- **Não editar `main` nem redefinir credenciais de usuários** durante esta auditoria. Uma troca apressada de sistema de identidade pode bloquear contas, invalidar sessões ou comprometer a migração.
- Preservar hashes/segredos em back-end seguro, políticas de acesso e MFA enquanto se planeja um fluxo equivalente de campos e aprovações.
- Reimplementar autenticação somente após matriz de estados/roles/casos negativos extraída integralmente do HTML V5.16 e plano de migração com testes; não acrescentar canais alternativos de acesso sem evidência/autorização.
- Manter PR #2 fora de merge e preservar seus 43 testes como evidência histórica/técnica de engenharia, não como aceite funcional do HTML.

**Status geral:** todos os ramos de Ouvidoria/SEMUS adicionados nas PRs #1, #3–#14 já foram identificados como divergentes e bloqueados. Agora há uma **divergência de UX pré-existente na `main`** que precisará de correção planejada, não de reset improvisado. Repo público exige que credenciais e dados pessoais jamais sejam versionados.
