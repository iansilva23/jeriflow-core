# Bloco 3 — acesso nos apps e no administrativo

Bloco técnico APROVADO nos cenários abaixo em 19/09/2026. A integração passou
em 37 cenários com PostgreSQL/Redis/Mailpit e Next reais. Depois da correção
da validação nativa, os tipos e 71 testes locais passaram. No iOS, os quatro
apps compilaram, foram instalados e abriram duas vezes com a tela de login,
na primeira tentativa da execução corrigida 35471104048. As oito aberturas
Android da revisão anterior tiveram suas imagens/hierarquias reconferidas.
Não há aprovação de produção, homologação física ou garantia de ausência de bugs.

## Evidência integrada

[Execução 35455021896](https://github.com/iansilva23/jeriflow-core/actions/runs/35455021896),
commit `29bdde95266371c14104c61bd0bca11ff09a4c14`, árvore
`617b680402380d939ec86449b92639392676fe99`. A integração levou 53 segundos.
O TAP conta 38 testes incluindo o grupo externo; são 37 cenários.
Relatório original em `evidence/auth-clients-35455021896/report.json` e metadados
em `evidence/github-auth-clients-35455021896.json`. ZIP conferido por SHA-256:
`1a26f8cff0d874663641771f51af7a2158e8df4a79e71fb4e3d85693c0e6d2ed`.
O lockfile desta revisão é
`47488a2e2c0a5716ad3504b92efd898b71d2357a9c0243c47caedf2965bc3b49`.
Também passaram o build do painel, suas rotas HTTP, os oito bundles móveis,
`npm ls --all` e a auditoria npm (zero alertas conhecidos nessa execução).

## Correção e evidência nativa

[Execução iOS 35471104048](https://github.com/iansilva23/jeriflow-core/actions/runs/35471104048),
commit `791ecc4aed8388768f21848535bc34ca3ac10bf3`, árvore
`4af304b582abcf321009c261c04317a3b2e71932`: quatro builds Release ARM64,
assinaturas ad-hoc verificadas, quatro instalações e oito aberturas aprovadas
no iPhone 17 Pro Simulator, iOS 26.5, Xcode 26.6. A etapa nativa levou 7m08s.
Relatório, OCR e capturas em `evidence/auth-native-35471104048/`; metadados em
`evidence/github-auth-native-35471104048.json`. ZIP do artefato 10592789032:
`9708733e494b4c0c83144e987efcc86f11acfb0aaeabd09c71ce5762f3c974cd`.
Todos os hashes de captura foram conferidos e as telas foram inspecionadas.

A execução anterior 35455080796 terminou verde após uma segunda tentativa do
emulador Android Guarda. A revisão visual, porém, REPROVOU suas oito capturas
iOS: os quatro apps exibiam falha no armazenamento protegido. O teste antigo
aceitava a marca e o aviso de desenvolvimento mesmo em uma tela de erro.
Os relatórios originais, inclusive o falso positivo e a falha Android anterior
à instalação, permanecem em `evidence/auth-native-35455080796/`; `review.json`
registra a reprovação sem reescrever o resultado original.

A correção foi no CI: `CODE_SIGNING_ALLOWED=NO` foi substituído pela assinatura
local de simulador. O armazenamento não foi enfraquecido nem substituído por
texto simples. Apps, backend e lockfile não mudaram nesta correção; por isso
os cenários integrados anteriores continuam aplicáveis. O novo teste exige
login completo e reprova explicitamente erro de conexão/cofre. A mesma falha
foi usada como teste de regressão, aprovado antes da nova compilação.

Android: Cidadão, Turista e Fiscal TTS abriram duas vezes na tentativa 1;
Guarda abriu duas vezes na tentativa 2 do run 35455080796. Na primeira, System
UI travou antes da instalação, mesmo após a recuperação limitada do emulador.
Essa ressalva de infraestrutura permanece; a segunda tentativa não prova que
a instabilidade foi eliminada. As oito telas finais foram reconferidas com
as novas exigências, sem recompilar código inalterado nem ocultar a falha.

## O que mudou

Os quatro apps mantêm seus nomes e utilizam a mesma implementação de login,
confirmação de email, recuperação de senha e autenticação em duas etapas.
O servidor define a etapa seguinte e os municípios/perfis permitidos. Botões
ficam bloqueados durante o pedido; falhas de rede e sessão encerrada têm retorno
visível. A confirmação de email e a troca de senha pedem um novo login.

O painel possui os mesmos fluxos em `/entrar`. O índice, os sete painéis e a
área TTS consultam o servidor em cada navegação. Não há autorização baseada
somente em esconder links. Admin Mestre é global; não recebe automaticamente
acesso operacional dos municípios. Administração TTS fica dentro do Turismo e
exige permissão própria; Fiscal TTS não recebe essa permissão.

Nos apps, o token é guardado pelo Expo SecureStore 57.0.4, com Keychain/Keystore
e chave separada por app. No iOS usa `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; Android
continua com backup desativado e exclui os dados do SecureStore da restauração.
O estado React não contém o Bearer. Falha ao gravar a sessão provoca tentativa
de revogação e recusa do login. Senhas/códigos não são persistidos pelo app.
O conteúdo é ocultado quando o app deixa de estar ativo; isso não equivale a
proibir capturas de tela pelo usuário ou proteger aparelhos comprometidos.

No navegador, o Bearer só circula entre o servidor Next e a API. Um cookie
HttpOnly, SameSite=Strict e Secure em HTTPS mantém a sessão. O BFF restringe
rotas/métodos, exige origem e cabeçalho próprios em POST, limita o corpo a 8 KiB
e cinco segundos e não encaminha cabeçalhos de privilégio do cliente.
Não usa localStorage/sessionStorage. Páginas autenticadas não são cacheadas.
No logout offline do navegador, informa que removeu a sessão local sem afirmar
revogação remota. Nos apps, falha de logout é exibida e pode ser tentada novamente.

O autenticador é configurado por chave manual, sem enviar o segredo a serviços
de QR externos. Os dez códigos de recuperação aparecem uma vez e o usuário
confirma que os guardou. Os códigos são exibidos antes de outra consulta de
rede, para não perdê-los por uma falha posterior à emissão.

## Operação de desenvolvimento

1. Preparar dependências: `npm run setup`.
2. Iniciar os serviços: `npm run infra:up` e `npm run identity:migrate`.
3. Provisionar somente contas fictícias conforme `IDENTIDADE.md`.
4. Em um terminal, executar `npm run dev:api`.
5. Em outro, executar `npm run dev:admin` e abrir `http://127.0.0.1:3000/entrar`.
6. Ler os códigos de email na caixa local `http://127.0.0.1:58025`.

O administrativo usa, por padrão, origem `http://127.0.0.1:3000` e API
`http://127.0.0.1:3001`. Para portas diferentes, configurar
`JERIFLOW_ADMIN_ORIGIN` e `JERIFLOW_API_URL` no processo do Next. A API não precisa
liberar CORS: o navegador fala somente com o Next. Não abrir pelo alias localhost;
a origem e o Host são comparados com a configuração.

As requisições administrativas chegam à API com o IP do Next; nesta configuração,
o limite por IP é compartilhado pelos usuários desse servidor, enquanto o limite
por conta é individual. O ambiente externo precisa de limites na entrada e proxy
confiável validado antes de dimensionar usuários. Não confiar em X-Forwarded-For
enviado pelo cliente nem declarar capacidade de produção com este arranjo local.

Nos apps, `EXPO_PUBLIC_API_URL` define a origem HTTPS da API durante a compilação
(sem `/api/v1`, credenciais ou parâmetros). Não colocar segredos em variáveis
EXPO_PUBLIC. Não existe endereço público configurado neste bloco. Sem configuração,
a tela abre e informa a ausência de servidor ao tentar entrar. O endpoint de teste
deve ser provisionado/validado antes de entregar um APK para uso conectado externo.
O adaptador admite HTTP somente em 127.0.0.1 quando `EXPO_PUBLIC_LOCAL_API=1`.
Essa opção serve ao desenvolvimento; não altera restrições TLS do Android/iOS
nem torna a API local acessível por um celular externo. Builds Release continuam
sem exceção global para tráfego HTTP. TLS/host do ambiente externo precisam de
validação própria; não desabilitar verificações de certificado.

## Verificações

A verificação nativa agora exige título de login, email, senha, entrada e
recuperação; erro explícito de conexão/cofre reprova imediatamente. Uma captura
real reprovada da execução 35455080796 foi incluída como regressão nos testes.
O CI iOS deixou de usar `CODE_SIGNING_ALLOWED=NO`: usa assinatura ad-hoc local
e verifica o binário com `codesign`. Isso não exige certificado Apple e não
substitui assinatura de distribuição. A execução corrigida confirmou a tela de
login no simulador, não a homologação física. O código nativo exato da falha
anterior não foi registrado.

- `npm run check`: tipos dos cinco clientes/API e testes de segurança, incluindo
  CSRF, cookie, normalização local do Next, limite de leitura e falha do cofre.
- `npm run build:admin && npm run test:admin`: Next compilado, login público,
  bloqueio de índice/sete painéis/TTS para anônimos e rotas inválidas.
- `npm run build:mobile`: oito bundles Android/iOS. Não prova binários nativos.
- `npm run identity:verify`: requer Next compilado e infraestrutura local. Usa
  os controladores reais dos quatro apps, adapter de cookie, servidor Next,
  API, PostgreSQL, Redis e Mailpit. Não substitui interação visual em aparelhos.
- Workflow nativo manual, plataforma `all`, app `all`: APKs e simuladores iOS,
  instalação e duas aberturas por app/plataforma. Usa captura e hierarquia/OCR.

O teste de controladores usa um cofre em memória para exercer HTTP/estados.
Abertura nativa exercita o carregamento e a leitura inicial do SecureStore;
persistência/reinstalação/biometria no dispositivo ainda exigem homologação.
A bateria HTTP do painel não mede cliques, teclado, autofill e leitores de tela.

## Limites e sequência

Cadastro público, provisionamento por painel, operações de negócio, entrega de
email externo, integração oficial de taxa, nuvem, aparelhos físicos e testes de
carga não foram concluídos aqui. Não há APK/IPA de loja ou liberação de produção.
Os painéis mostram explicitamente que as operações estão em desenvolvimento.
O próximo bloco funcional é gestão de contas/perfis e cadastro, com suas próprias
regras de aprovação; as evidências do fechamento atual estão registradas acima.
O fechamento acima cobre integração de controladores/HTTP e abertura da tela de
login em dispositivos virtuais. Cliques, teclado, autofill, acessibilidade e
persistência de sessão real no aparelho precisam de homologação específica;
não foram medidos pelo teste de abertura e não estão sendo aprovados por ele.

Referências: [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/),
[Cookies no Next](https://nextjs.org/docs/app/api-reference/functions/cookies).
