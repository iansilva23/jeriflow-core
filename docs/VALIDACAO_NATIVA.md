# Validação nativa da base

Escopo: Cidadão, Turista, Guarda/SEMUS e Fiscal TTS. São telas técnicas de
desenvolvimento; estas verificações não aprovam funcionalidades de negócio.
O status da Etapa 2 depende das evidências concluídas, não da existência do workflow.

## Execução de 17/09/2026

[Execução 35254071139](https://github.com/iansilva23/jeriflow-core/actions/runs/35254071139),
commit `e44176142f5087e341b5b15e4356b15a72f89ce1`.

- iOS: quatro compilações Release ARM64, quatro instalações e oito aberturas
  aprovadas em iPhone 17 Pro Simulator, iOS 26.5, Xcode 26.6. As telas foram
  verificadas automaticamente por OCR e inspecionadas visualmente.
- Android: cancelado. O GitHub registrou que o job excedeu o teto de 55 minutos.
  O trecho final visível também registra `:app:mergeReleaseNativeLibs FAILED`,
  seguido de compilação Kotlin; não há mensagem completa que permita atribuir
  essa falha a memória, espaço ou dependência específica. O download do log do
  job retornou 404 e nenhum artefato Android foi publicado. Não está aprovado.
- Verificações locais desta alteração: TypeScript de todos os pacotes e 31 testes
  aprovados. O teste completo da base/servidor continua registrado separadamente.

Relatório original iOS, textos reconhecidos e oito capturas estão em
`docs/evidence/native-35254071139/ios/`. Metadados da execução e checksum do ZIP
estão em `docs/evidence/github-native-ios-35254071139.json`.
As imagens originais foram preservadas; uma captura inclui uma notificação do
próprio simulador e capturas imediatas podem mostrar transições da interface do iOS.

## Correção antes da segunda tentativa

Foi reproduzido localmente um defeito no controlador: `spawn` com timeout
encerrava somente o processo pai. A espera pelo evento `close` continuava enquanto
um descendente mantivesse os pipes abertos. O novo `native-process.mjs` cria um
grupo POSIX por comando, envia TERM e depois KILL ao grupo e encerra a espera
mesmo sem `close`. Não sinaliza processos de outros grupos.

Os testes executam descendentes reais que ignoram TERM, tanto com pai ativo
como com pai já encerrado. Com prazo de 600 ms e tolerância de encerramento de
50 ms, ambos terminaram em menos de 700 ms na verificação local. Também passaram
cancelamento, código de erro, comando inexistente, saída binária e limite de
saída. TypeScript e os 37 testes do projeto passaram antes do novo disparo.

O diagnóstico da primeira execução foi preservado em
`docs/evidence/github-native-android-35254071139.json`. Ele é um registro do
encerramento observado, não um relatório de teste aprovado.

Android agora compila um app por runner. Kotlin compartilha o processo do Gradle;
na segunda tentativa, o heap Gradle tinha teto de 2 GiB, metaspace de 768 MiB, dois workers e projetos
sem execução paralela. Os dois ABIs continuam obrigatórios. Essas medidas
controlam recursos; não são uma afirmação de que houve falta de memória.
Cada comando registra início, fim e duração. O relatório salva progresso,
memória/disco e caudas de erro; SIGINT/SIGTERM marcam interrupção e encerram
os comandos. A perda abrupta da máquina ou SIGKILL ainda pode impedir o envio.

## Segunda execução: compilação aprovada, emulador encerrado

[Execução 35286201979](https://github.com/iansilva23/jeriflow-core/actions/runs/35286201979),
commit `065895e0a37b0e3e5b43746dd2e73a7094af6272`, duas tentativas em 17/09/2026.
Ambas compilaram o Cidadão em Release ARM64/x86_64 e aprovaram manifesto e bundle
incorporado. As compilações levaram 10m54s e 11m33s. Ambas falharam na inicialização
do emulador, sem instalação ou abertura do app. A segunda tentativa executou o
mesmo commit; repetir uma execução não incorpora alterações posteriores de main.

Os relatórios registram somente cerca de 1,3 GiB livres no disco durante a falha,
com cerca de 7 GiB de memória livre. A documentação Android exige ao menos 5 GB
para iniciar o emulador. Isso comprova uma deficiência de espaço na rotina;
a mensagem interna do emulador não foi capturada na versão anterior, portanto
não se atribui a ela uma causa única sem nova evidência. O log da segunda tentativa
também registra pressão de metaspace, embora a compilação tenha terminado com sucesso.
Relatórios originais e checksums estão em `docs/evidence/native-35286201979/android/`
e `docs/evidence/github-native-android-35286201979.json`.

### Correção de 18/09/2026, antes de testar novamente

- Instalar a imagem do emulador somente após concluir a compilação.
- Preservar o APK verificado e conferir seu SHA-256 antes e depois da cópia.
  Remover somente o projeto Android gerado e o cache Gradle exclusivo desta
  execução, além do NDK já utilizado, pelo sdkmanager do runner descartável.
- Isolar o diretório AVD no espaço temporário e exigir 6 GiB livres antes do boot.
  A limpeza registra espaço antes/depois e mantém fontes e dependências do projeto.
- Usar o renderizador SwiftShader recomendado e guardar até 16 KiB do log do
  emulador, código de saída e sinal. Um processo encerrado falha imediatamente,
  sem aguardar inutilmente os quatro minutos reservados ao boot.
- Aumentar somente o metaspace de 768 MiB para 1 GiB, mantendo heap de 2 GiB,
  dois workers, ABIs obrigatórios e os mesmos limites de tempo.

TypeScript e 41 testes locais passaram. As novas regressões conferem os bytes
do APK após a limpeza, recusam caminhos indevidos/links/sobrescrita/checksum
incorreto e distinguem boot transitório de processo encerrado e cancelamento.
O job inicial agora testa também a preservação do APK antes de compilar.

A próxima execução deve ser nova, no commit corrigido, começando pelo Cidadão.
Depois de conferir instalação e duas aberturas, validar os quatro Android.
A aprovação de um app não aprova os outros três. iOS mantém sua evidência
histórica; alterações na rotina não reescrevem esse resultado.

## Rotina

`.github/workflows/native.yml` começa somente por acionamento manual. O campo
`platform` permite `android`, `ios` ou `all`; o campo `app` permite um Android
específico ou `all`. Para iOS, selecionar `all`. Usa runners temporários
Ubuntu 24.04 para Android e macOS 26 para iOS. Não publica
apps, não usa conta de loja, não contrata VPS e não executa integrações de negócio.
Antes de cada nova rodada, conferir a franquia restante e o bloqueio de gastos
na conta. O limite de tempo do job não substitui o limite financeiro.

Antes das compilações, um job de até cinco minutos verifica os subprocessos e
gera a matriz a partir do catálogo. São no máximo dois jobs nativos simultâneos.
Cada Android tem teto interno de 28 minutos, etapa de 30 e job de 35; a compilação
Gradle tem prazo próprio de 15 minutos. iOS mantém os quatro apps juntos, com
teto interno de 45 minutos, etapa de 48 e job de 55. A diferença reserva tempo
para limpeza e envio de evidências. Não há repetição automática nem cancelamento
do outro sistema caso uma plataforma falhe. Checkout sem credenciais persistidas,
permissão de leitura e Actions oficiais fixadas por SHA.

`scripts/native-runner.mjs` recusa execução fora do GitHub e evidência preexistente.
Usa o lockfile do projeto e o template Expo 57.0.24 com SHA-512 conferido antes
da geração. Recusa alterações de dependências durante o prebuild.

| Verificação | Android | iOS |
| --- | --- | --- |
| Compilação | Release, ARM64 e x86_64 | Release para simulador na arquitetura do runner |
| Identidade | Package do APK igual ao app.json | Bundle identifier igual ao app.json |
| Código incorporado | Bundle dentro do APK | main.jsbundle dentro do .app |
| Instalação e abertura | Emulador Android API 36 | iPhone Simulator disponível no Xcode 26.6 |
| Duas partidas do app | Reinício após force-stop | Reinício após encerramento do processo anterior |
| Tela correta | Hierarquia nativa via UI Automator | OCR local da captura via Apple Vision |
| Evidências | Imagem, hierarquia e checksum | Imagem, texto reconhecido e checksum |

A abertura só passa quando o processo está vivo e a tela contém o nome do app,
o aviso de ambiente de desenvolvimento e a orientação de não usar dados reais.
Splash, tela vazia, tela de outro app ou apenas compilação não são aprovação.

O manifesto final Android é conferido após a compilação: identidade, backup
desabilitado, ausência de modo depurável e das permissões bloqueadas. A permissão
SYSTEM_ALERT_WINDOW herdada do template foi bloqueada nos quatro apps porque
essa base não precisa desenhar sobre outros aplicativos.

## Evidências e limites

O relatório registra commit, execução, tentativa, apps selecionados, ferramentas,
dispositivo, checksum do lockfile, binários e imagens. Falha produz saída diferente de zero
e relatório de falha; resultados parciais não viram aprovação completa.
Os artefatos são separados por plataforma e app. Android completo exige os quatro
relatórios aprovados e oito aberturas; um job isolado aprovado não fecha a etapa.

Somente report.json, imagens PNG e textos de tela são enviados como artefatos,
com retenção de três dias. Não são enviados node_modules, SDKs, caches, instaladores,
certificados ou chaves. Evidências selecionadas e revisadas devem ser preservadas
no repositório após baixar e conferir os checksums dos artefatos.

Android usa a chave pública de desenvolvimento do template, mesmo na configuração
Release. iOS usa compilação para Simulator sem assinatura. Isso não entrega APK
assinado para distribuição, IPA, homologação em aparelhos físicos ou publicação
nas lojas. ARM64 compilado não significa ARM64 executado quando o emulador é x86_64.

Login/MFA, banco de negócio, autorização por perfil/município, TTS operacional,
pagamentos, denúncias e demais funções permanecem fora desta base. Teste de
carga, recuperação de desastres e segurança do produto completo exigem essas
implementações e verificações próprias.

## Referências

- [Expo CLI e compilação nativa](https://docs.expo.dev/more/expo-cli/)
- [Ferramentas do runner macOS 26](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md)
- [Ferramentas do runner Ubuntu 24.04](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
- [Android Debug Bridge](https://developer.android.com/tools/adb)
- [Reconhecimento de texto local no Apple Vision](https://developer.apple.com/documentation/vision/vnrecognizetextrequest)
- [Grupos e ciclo de vida de subprocessos Node](https://nodejs.org/api/child_process.html)
- [Execução do compilador Kotlin](https://kotlinlang.org/docs/compiler-execution-strategy.html)
- [Limites de recursos do Gradle](https://docs.gradle.org/current/userguide/build_environment.html)

- [Espaço mínimo e renderização do emulador Android](https://developer.android.com/studio/run/emulator-troubleshooting)
- [Gerenciamento de pacotes Android SDK](https://developer.android.com/tools/sdkmanager)
