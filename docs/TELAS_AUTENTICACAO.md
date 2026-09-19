# Bloco 3 — acesso nos apps e no administrativo

Integração APROVADA em 19/09/2026: 69 testes de código e 37 cenários com
PostgreSQL/Redis/Mailpit e Next reais, sem falhas na primeira tentativa.
Compilação/abertura nativa: execução 35455080796 em andamento; o fechamento
completo deste bloco depende dessa evidência. Não há aprovação de produção.

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
regras de aprovação; o bloco atual só fecha após registrar a validação exigida.

Referências: [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/),
[Cookies no Next](https://nextjs.org/docs/app/api-reference/functions/cookies).
