# Controle da Etapa 2

Revisão: 18/09/2026. Status: EM FECHAMENTO — validação nativa aprovada; instabilidade do emulador ainda registrada.

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
    em 17/09/2026. As execuções remotas posteriores estão registradas abaixo.
    O diagnóstico do Mac passou a ser uma alternativa local.
13. Enviados os 62 arquivos iniciais ao repositório privado, com árvore Git idêntica
    à cópia local. A primeira execução real identificou falha de infraestrutura:
    trim(text) preservava a quebra de linha do secret ao criar a senha PostgreSQL.
    Corrigida a normalização de LF/CRLF e validado o formato antes de criar o papel.
    A segunda execução passou nas oito verificações, incluindo conexão e operações
    reais no PostgreSQL/Redis. Não houve remoção de volumes nem rotação de senhas
    em ambientes preexistentes; a correção atua na inicialização de bancos novos.
14. Atualizadas as três Actions oficiais para versões Node 24 fixadas por commit,
    após aviso de descontinuação do runtime anterior. Acrescentados testes da
    execução manual, limite de tempo, privilégios mínimos e publicação restrita
    ao relatório novo. O conjunto passou a 27 testes aprovados localmente e na
    terceira execução remota. Essa execução passou nas oito verificações e em
    todos os passos do job, incluindo encerramento dos serviços e envio da evidência.
15. Bloqueada a permissão Android SYSTEM_ALERT_WINDOW herdada do template,
    desnecessária para estas telas. Acrescentada rotina nativa manual com tempo
    limitado, template verificado por SHA-512 e evidências de instalação/abertura.
    TypeScript e 31 testes passaram localmente após essa alteração.
16. Quatro apps iOS compilados em Release ARM64, instalados e abertos duas vezes
    cada em iPhone 17 Pro Simulator, iOS 26.5, Xcode 26.6. A execução 35254071139
    aprovou o job iOS; relatório, textos reconhecidos e oito capturas originais
    foram preservados no repositório após conferência dos checksums.
    O job Android da mesma execução excedeu o teto de 55 minutos e foi cancelado.
17. Reproduzido e corrigido travamento do controlador de processos: o timeout
    matava o pai, mas aguardava pipes mantidos abertos pelos descendentes.
    Comandos agora têm grupo próprio, encerramento TERM/KILL com prazo limitado,
    cancelamento e captura de erro limitada em bytes. Android passa a um app por
    runner, máximo de dois jobs simultâneos, memória Gradle controlada e Kotlin
    no mesmo processo. Acrescentados diagnósticos de memória/disco, progresso,
    gravação atômica do relatório e etapa de regressão antes de compilar na nuvem.
    TypeScript e 37 testes locais passaram antes da nova tentativa nativa.
    Isso não comprova aprovação Android nem identifica sozinho a causa da
    falha de mergeReleaseNativeLibs vista no final do log da primeira execução.

18. As duas tentativas da execução 35286201979 compilaram o APK Cidadão, mas
    falharam antes da instalação: o emulador encerrou e havia somente 1,3 GiB
    livres no disco. Corrigida a sequência para preservar o APK, remover os
    intermediários exclusivos e instalar a imagem do emulador depois da compilação.
    A rotina exige 6 GiB livres, captura o erro interno do emulador e interrompe
    imediatamente a espera quando ele encerra. Corrigida a pressão de metaspace
    observada no log, sem aumentar o tempo limite. TypeScript e 41 testes locais
    passaram. Instalação e abertura Android ainda dependem da nova execução.

19. A execução 35308314510 compilou o APK em 11m01s, mas a margem de disco
    interrompeu antes de iniciar o emulador: 5,91 GiB livres para um mínimo
    configurado de 6 GiB. Completada a limpeza com node_modules do checkout
    descartável, desnecessário após preservar o APK. Fontes e links de workspaces
    são verificados nos testes de preservação. A margem de espaço e os prazos
    foram mantidos. TypeScript e 42 testes locais aprovados antes de nova execução.

20. A execução 35309547794 iniciou o emulador e instalou o APK Cidadão. Abertura
    falhou porque a hierarquia mostrava outro pacote. Corrigida a perda das
    evidências de tela nas falhas e preparada a ativação/desbloqueio da tela do
    emulador. Separados jobs de compilação e abertura, com APK temporário privado
    conferido por hash, execução, commit, app, lockfile e template. TypeScript e
    45 testes locais passaram; o novo fluxo ainda exige validação real.

21. Confirmado System UI ANR antes da instalação na execução 35372117436.
    Configurado emulador com tela 540×960, 4 GiB, KVM e GLES sem Vulkan;
    checagem de tela inicial antes da instalação. A execução 35372955675
    instalou e abriu Cidadão duas vezes, sem reinicialização de recuperação.
    O APK foi reaproveitado com origem e hash conferidos. TypeScript e 49 testes
    locais passaram. Validação dos quatro Android ainda pendente; preparada
    execução em quatro runners independentes para reduzir a espera.

22. Execução 35373594989: quatro APKs compilados, instalados e abertos duas vezes.
    Turista, Guarda e Fiscal TTS passaram na primeira tentativa; Cidadão na
    segunda, acionada pelo responsável. Nove artefatos conferidos por SHA-256;
    oito capturas aprovadas, relatório e captura da primeira falha preservados.
    System UI do emulador voltou a travar na primeira tentativa de Cidadão;
    a repetição passou, mas não elimina a ressalva de estabilidade do teste.

## Evidências e critérios

docs/VERIFICATION.json registra comandos, códigos de saída, duração e hash do
lockfile. Ele preserva a execução LOCAL de 16/09/2026, na qual faltavam os bancos.
Relatórios remotos originais, acompanhados de identificação de execução, commit
e checksum do artefato, estão em docs/evidence/. O índice está em
docs/TESTES_NA_NUVEM.md. Logs locais são gerados em artifacts/, fora do pacote.
Um teste que apenas inspeciona YAML não comprova funcionamento do banco.

- [x] Quatro apps e sete áreas catalogados; sem um quinto app Transporte.
- [x] Instalação limpa executada com npm fixado pelo comando de preparação.
- [x] Dependência corrigida confirmada por carregamento real e teste de regressão.
- [x] TypeScript e 49 testes aprovados localmente; última bateria completa do servidor na nuvem com 27 testes.
- [x] Administrativo compilado e rotas verificadas via HTTP.
- [x] Oito bundles móveis gerados (quatro apps × Android/iOS).
- [x] Projetos nativos gerados usando expo-template-bare-minimum 57.0.24.
- [x] Manifestos Android e leitura/escrita dos projetos Xcode conferidos.
- [x] Configuração PostgreSQL/Redis e testes reais de integração preparados.
- [x] API permanece disponível nos cenários testados de conexão interrompida e sem resposta.
- [x] PostgreSQL/Redis reais em execução na nuvem com conectividade e operações aprovadas.
- [x] Quatro compilações iOS e oito aberturas no iPhone Simulator aprovadas.
- [x] Compilação e abertura dos quatro apps Android/iOS aprovadas em emuladores/simuladores, com a ressalva abaixo.
- [x] Ambiente remoto Linux com Docker e funcionamento da bateria da base conferidos.
- [x] Ferramentas Android/iOS, compilação, instalação e oito aberturas por plataforma conferidas.
- [ ] Encerrar a instabilidade intermitente de System UI no emulador Android antes de declarar a etapa totalmente fechada.

Os oito bundles contêm código JavaScript/Hermes. Não são APK, AAB ou IPA.
Gerar arquivos de projeto Xcode não é compilar nem executar no iPhone.

## Bloqueios reais

Docker/Compose, PostgreSQL, Redis e adb não estão disponíveis no ambiente local do assistente.
A tentativa anterior de instalar serviços foi bloqueada por permissões do sistema.
Os testes de banco foram executados com sucesso no runner Linux do GitHub.
O ambiente local é Linux e não possui Xcode. A compilação e a execução iOS foram
concluídas no runner macOS, usando Simulator. Os quatro apps já compilaram, foram instalados e abriram duas vezes no Android 16.
A execução completa só ficou aprovada após repetir Cidadão. A instabilidade
do System UI do emulador permanece como ressalva; não há evidência de crash
do processo JeriFlow nesse incidente.
Não houve assinatura de produção, publicação nas lojas, teste em aparelho físico
ou homologação operacional. Consulte docs/VALIDACAO_NATIVA.md.

infra:check conecta SOMENTE aos endereços locais dedicados. Deve falhar enquanto
os serviços estiverem ausentes; não será substituído por simulação para obter
uma aprovação aparente. Com os serviços disponíveis, verifica:

- PostgreSQL: conexão, ausência de privilégios administrativos do usuário da API,
  escrita/leitura em tabela temporária e rollback.
- Redis: autenticação, PING, escrita/leitura com expiração e remoção da chave de teste.

O workflow de CI executou esses testes em ambiente com Docker. A conexão,
escrita/leitura, rollback PostgreSQL e remoção da chave temporária Redis foram
aprovados nas execuções 35221754364 e 35222197781. Consulte docs/TESTES_NA_NUVEM.md.

## Próximo passo que permite fechar a etapa

Tratar a instabilidade intermitente do emulador observada na execução completa.
Não repetir compilações para diagnosticar um problema apenas de inicialização
do dispositivo: o fluxo já permite reaproveitar o APK com origem e hash conferidos.
Depois desse fechamento, implementar o núcleo central: persistência de usuários
e municípios, autenticação, permissões de cada app/painel e auditoria de operações.
As regras de negócio devem seguir o escopo aprovado da V5.16, inclusive TTS manual.
A validação iOS foi executada no Mac temporário do GitHub com Xcode e Simulator.
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
