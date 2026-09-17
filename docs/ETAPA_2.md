# Controle da Etapa 2

Revisão: 17/09/2026. Status: EM ANDAMENTO — não iniciar a etapa seguinte.

## Escopo deste pacote

Base de desenvolvimento de quatro apps instaláveis no futuro: Cidadão, Turista,
Guarda/SEMUS e Fiscal TTS; administrativo web com sete áreas; API de diagnóstico.
As telas são identificadores e avisos de desenvolvimento, NÃO funções de negócio
concluídas. O protótipo V5.16 permanece separado e não foi alterado ou importado.

Não há app Transporte: essa função pertence ao Turista e ao Admin Turismo.
O Fiscal TTS é um app móvel, distinto da administração da TTS. O modelo permanece
baseado em conferência manual do comprovante, autorização e token; isso não é
integração com o banco oficial da taxa. TTS e benefício do estacionamento são
independentes. Nenhuma regra operacional foi modificada nesta etapa técnica.

## Correções desta retomada

1. Reconstruído o lockfile em cópia isolada. A instalação anterior mantinha
   uuid 7.0.3 apesar das tentativas de override. A cópia antiga foi preservada.
   A configuração final substitui uuid apenas sob xcode.
2. Fixado npm 12.0.2 e Node 24.15+ da série 24. No teste comparativo, npm 11.9.0
   reportava a substituição como inválida; npm 12.0.2 reconheceu o override.
   npm run setup usa a versão fixada sem modificar o npm global.
3. Regressão verifica uuid 11.1.1 realmente carregado pelo xcode, rejeição de
   escrita em buffer pequeno e geração de identificadores.
4. Apps limitados a Android/iOS. Eliminada a tentativa indevida de exportar web.
5. Desabilitado backup automático Android e bloqueadas permissões de gravação
   de áudio e armazenamento externo desnecessárias nesta base.
6. Preparação local protege segredos, preserva configurações e recusa links
   simbólicos, conexões divergentes e permissões excessivas. Senhas aleatórias
   não são exibidas nem entram no pacote. Não é um cofre de produção.
7. API recusa operações não implementadas, produção e portas inválidas; trata
   falhas de dependências sem revelar detalhes. Banco/cache disponíveis não tornam
   o produto pronto: /health/ready permanece 503 deliberadamente.
8. Testados índice, sete rotas administrativas, links de ida/volta e quatro rotas
   inválidas via HTTP. Não é teste visual, de login ou de autorização de usuários.
9. Bateria reproduzível npm run verify, com resultados reais em VERIFICATION.json.
   O processo retorna falha se qualquer verificação executada falhar.
10. Acrescentados dois testes de falhas de conexão com sockets TCP locais:
    servidores que aceitam a conexão e não respondem; conexões encerradas durante
    a sondagem. Ambos passaram. A API continuou respondendo, devolveu indisponibilidade
    sem detalhes internos, encerrou conexões e voltou a sondar depois da expiração.
    Doze consultas simultâneas compartilharam uma sondagem por dependência.
    Isso verifica contenção de falhas, não capacidade de produção nem integração
    bem-sucedida com PostgreSQL/Redis.
11. Incluídos COMECE_AQUI.md e VERIFICAR_MAC.command para identificar ferramentas
    no computador do responsável sem instalar programas. A sintaxe Bash foi aprovada
    e a recusa de execução em Linux foi confirmada. A execução em macOS permanece
    pendente; o diagnóstico não substitui testes de banco ou compilação nativa.
12. Preparada a continuação na nuvem após conectar GitHub. O workflow passou a
    ter início manual, a executar a mesma bateria com os containers PostgreSQL/Redis
    e a guardar somente o relatório novo por três dias. A estrutura YAML foi lida
    sem erros. O repositório privado foi criado e o acesso de escrita foi confirmado
    em 17/09/2026. Não houve execução remota comprovada nesta revisão.
    O diagnóstico do Mac passou a ser uma alternativa local.

## Evidências e critérios

docs/VERIFICATION.json registra comandos, códigos de saída, duração e hash do
lockfile. Logs locais são gerados em artifacts/, fora do pacote.
Um teste que apenas inspeciona YAML não comprova funcionamento do banco.

- [x] Quatro apps e sete áreas catalogados; sem um quinto app Transporte.
- [x] Instalação limpa executada com npm fixado pelo comando de preparação.
- [x] Dependência corrigida confirmada por carregamento real e teste de regressão.
- [x] TypeScript e 24 testes automatizados da base aprovados nesta retomada.
- [x] Administrativo compilado e rotas verificadas via HTTP.
- [x] Oito bundles móveis gerados (quatro apps × Android/iOS).
- [x] Projetos nativos gerados usando expo-template-bare-minimum 57.0.24.
- [x] Manifestos Android e leitura/escrita dos projetos Xcode conferidos.
- [x] Configuração PostgreSQL/Redis e testes reais de integração preparados.
- [x] API permanece disponível nos cenários testados de conexão interrompida e sem resposta.
- [ ] PostgreSQL/Redis em execução com conectividade e transações aprovadas.
- [ ] Compilação nativa Android/iOS e execução no ambiente de destino aprovadas.
- [ ] Ambiente de execução escolhido, local ou remoto, com ferramentas e funcionamento conferidos.

Os oito bundles contêm código JavaScript/Hermes. Não são APK, AAB ou IPA.
Gerar arquivos de projeto Xcode não é compilar nem executar no iPhone.

## Bloqueios reais

Docker/Compose, PostgreSQL, Redis e adb não estão disponíveis neste ambiente.
A tentativa anterior de instalar serviços foi bloqueada por permissões do sistema.
Este ambiente é Linux e não possui Xcode. Não houve compilação nativa, assinatura,
publicação nas lojas, teste em aparelho real ou homologação.

infra:check conecta SOMENTE aos endereços locais dedicados. Deve falhar enquanto
os serviços estiverem ausentes; não será substituído por simulação para obter
uma aprovação aparente. Com os serviços disponíveis, verifica:

- PostgreSQL: conexão, ausência de privilégios administrativos do usuário da API,
  escrita/leitura em tabela temporária e rollback.
- Redis: autenticação, PING, escrita/leitura com expiração e remoção da chave de teste.

O workflow de CI foi preparado para executar esses testes em ambiente com Docker.
A conta GitHub iansilva23 e o acesso ao repositório privado jeriflow-core foram
confirmados. Não existe execução remota comprovada nesta revisão.
Consulte docs/TESTES_NA_NUVEM.md.

## Próximo passo que permite fechar a etapa

Executar a base em ambiente autorizado com Docker e ferramentas nativas.
Para iOS, é necessário Mac com Xcode ou serviço de compilação aprovado.
Não foi contratado serviço nem aceita contratação de conta.
O assistente continua responsável pelo código e testes; o responsável só precisa
realizar ações locais ou autorizações às quais o assistente não tem acesso.

Não fornecer senhas, tokens, número de série do Mac nem dados pessoais reais no chat.
COMECE_AQUI.md registra o repositório privado e a continuação na nuvem.
A ferramenta de diagnóstico do Mac permanece disponível como alternativa.
Se essa alternativa for escolhida, conferir macOS, chip e memória antes de indicar
instalações. O diagnóstico não lê as credenciais do projeto.

## Não entregue como operacional

Login/MFA, denúncias, protocolos, estacionamento, pagamentos, chat, QR operacional,
push, integrações oficiais, autorização por perfil/município e trilha de auditoria
de negócio ainda não foram implementados nesta base. Tampouco foram executados
teste de carga, restauração de banco, pentest ou validação jurídica.

Zero alertas conhecidos no auditor de dependências é uma observação da execução,
não uma garantia de ausência de vulnerabilidades. Capacidade e disponibilidade
continuam metas a medir. Não liberar dados reais, venda como produto pronto ou
produção com base neste pacote.

## Referências técnicas

- Advisory: https://github.com/advisories/GHSA-w5hq-g745-h8pq
- Overrides: https://docs.npmjs.com/cli/v12/configuring-npm/package-json/#overrides
- Configuração móvel: https://docs.expo.dev/versions/latest/config/app/
- Projetos e builds locais: https://docs.expo.dev/build-reference/local-builds/

Nuvem, titularidade das contas/apps, responsabilidades de proteção de dados,
contratos/SLA e integrações oficiais exigem decisões específicas antes de seus
respectivos usos; nenhuma dessas decisões é implicitamente aprovada por este código.
