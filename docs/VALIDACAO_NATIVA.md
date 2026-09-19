# Validação nativa da base

## Fechamento técnico — 19/09/2026

[Execução 35380520136](https://github.com/iansilva23/jeriflow-core/actions/runs/35380520136),
commit `a3241c689f01fa9a739c1cb6a236cb7d9eb5da78`: Guarda instalado e aberto
duas vezes, após 31,7 segundos e sete amostras de prontidão; sem reboot.
Artefato 10562410088, ZIP SHA-256
`c9dc1083b659c92eb71048e83a928dfc43b86a9317941d1148799dedd74b0753`.
Relatório, capturas e hierarquias em `evidence/native-35380520136/android/guarda/`.

Somado aos três apps aprovados na execução 35379274017, isso fecha a
revalidação da preparação Android. Oito aberturas aprovadas e sem recuperação
nos respectivos jobs finais. Ambos os runs reutilizaram APKs do commit
`fe12be134403532435e65a388c903ef3730fed10`, com integridade e fontes conferidos.
A validação iOS 35254071139 cobre os mesmos fontes e dependências dos apps.
Etapa 2 concluída como base técnica. Não é teste de funções de negócio,
aparelhos físicos, carga ou garantia de ausência de falhas futuras.
As seções seguintes são o histórico; ressalvas ali descritas não apagam os
resultados posteriores nem convertem falhas antigas em aprovações.

## Verificação de estabilidade — execução 35379274017

O mecanismo com capturas exclusivas e observação contínua aprovou Cidadão,
Turista e Fiscal TTS na primeira tentativa, com duas aberturas cada e sem
reinicialização do emulador. APKs da execução 35373594989 foram reaproveitados
com origem, fontes e hashes conferidos. Nenhum app foi recompilado.

Guarda parou antes da instalação. Os dois registros de WindowManager tinham
uma janela de ANR de System UI com `isOnScreen=false`, `isVisible=false` e
`Surface: shown=false`. As capturas não mostravam o diálogo. O detector anterior
tratava a simples existência dessa janela como erro definitivo, antes de
acompanhar sua evolução. Isso não demonstra falha do aplicativo Guarda.

Correção: alerta explicitamente invisível impede a prontidão e reinicia a
contagem de estabilidade, mas aguarda dentro do prazo existente. Alerta visível
ou sem informação suficiente continua fatal. Se o alerta invisível persistir
até o prazo, a preparação também falha e permite apenas a recuperação limitada
já existente. Não se fecham diálogos nem se ignoram alertas para aprovar apps.
Regressão usa os registros reais de alerta invisível e de diálogo visível.
O diagnóstico final também passa a guardar avisos dos serviços do Android.
A revalidação dessa correção foi aprovada na execução 35380520136, acima.

Escopo: Cidadão, Turista, Guarda/SEMUS e Fiscal TTS. São telas técnicas de
desenvolvimento; estas verificações não aprovam funcionalidades de negócio.
O status da Etapa 2 depende das evidências concluídas, não da existência do workflow.

## Resultado consolidado — 18/09/2026

[Execução Android 35373594989](https://github.com/iansilva23/jeriflow-core/actions/runs/35373594989),
commit `fe12be134403532435e65a388c903ef3730fed10`: quatro compilações Release,
quatro instalações e oito aberturas aprovadas. Turista, Guarda/SEMUS e Fiscal TTS
passaram na primeira tentativa. Cidadão passou na segunda tentativa, iniciada
pelo responsável, reutilizando o APK da primeira. Relatórios originais,
hierarquias, capturas e checksums foram conferidos e preservados em
`docs/evidence/native-35373594989/android/`.

**Ressalva naquela execução:** na primeira tentativa de Cidadão, o emulador apresentou
novamente “System UI isn't responding” sobre a tela do app. Na segunda, houve
recuperação de System UI antes da instalação e as duas aberturas passaram.
O resultado comprova funcionamento nos cenários aprovados; repetir o job
não demonstra que a instabilidade do emulador foi eliminada. A falha original
permanece preservada. Não ampliar esse resultado para garantia de ausência
de bugs ou aprovação de funcionalidades operacionais.

A validação iOS anterior (35254071139) continua aplicável aos mesmos fontes
e dependências dos apps. O código da aplicação não mudou nesta correção.

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

## Terceira execução e conclusão da limpeza

[Execução 35308314510](https://github.com/iansilva23/jeriflow-core/actions/runs/35308314510),
commit `90f32a2e29ca9fc7de766b4cb8e6121aa73a50a7`, em 18/09/2026.
O APK compilou em 11m01s e passou nas inspeções. A limpeza recuperou espaço de
6.840.549.376 para 11.793.539.072 bytes. Após instalar a imagem Android, restaram
6.347.423.744 bytes (6,35 GB / 5,91 GiB), abaixo da margem de 6 GiB (6.442.450.944 bytes).
O próprio teste interrompeu antes de iniciar o emulador. Não foi um novo timeout
ou uma falha de compilação; a margem foi mantida e a limpeza foi completada.

A versão seguinte também remove node_modules do checkout descartável após
preservar e verificar o APK. A partir desse ponto, instalação e abertura usam
somente ferramentas Android e módulos internos do Node. As fontes apps/ e
packages/ permanecem preservadas, inclusive quando há links de workspaces.
Testes reais de arquivos verificam essa preservação e recusam node_modules
substituído por link externo antes de qualquer remoção. A bateria local agora
contém 42 testes aprovados. Relatório original e checksums estão em
`docs/evidence/github-native-android-35308314510.json`.
Abertura Android continua pendente até uma execução completa aprovada.

## Quarta execução: emulador iniciado e APK instalado

[Execução 35309547794](https://github.com/iansilva23/jeriflow-core/actions/runs/35309547794),
commit `9481bb71598b168dbe4643362003795f2bbb0daf`.
A limpeza adicional recuperou espaço até 13.388.120.064 bytes antes da imagem.
O emulador confirmou espaço suficiente e iniciou Android 16/API 36 em x86_64.
O APK Cidadão foi instalado e o processo respondeu à consulta pidof, mas a
hierarquia de tela não continha o pacote esperado durante a primeira abertura.
O teste falhou com “Outro app está em primeiro plano”. Não há aprovação de abertura.

A versão anterior descartava a hierarquia e não capturava screenshot/logcat quando
uma asserção de tela falhava. Portanto não é possível identificar a janela que
estava à frente nem afirmar que era a tela de bloqueio. Esse defeito de diagnóstico
foi corrigido. A preparação do dispositivo agora acorda a tela com KEYCODE_WAKEUP
e solicita wm dismiss-keyguard antes de abrir o app. Isso atua somente no emulador
novo, sem credenciais; não muda a segurança dos aplicativos distribuídos.
Não fecha diálogos de erro para obter aprovação aparente.

Compilação e teste de abertura agora usam jobs/runners separados. O segundo não
instala dependências npm, não compila código e verifica que recebeu o APK e o
relatório da mesma execução/commit/app/lockfile/template. Reconfere SHA-256 e
manifesto. Somente duas aberturas com processo vivo e texto correto aprovam o app.
Os testes de transferência rejeitam APK alterado, links, identidade divergente,
outro commit/execução e compilação incompleta. TypeScript e 45 testes locais
passaram antes da execução deste fluxo.

O estado observado da tela é salvo antes das asserções. Falhas coletam captura,
janelas, atividades e logs limitados de erros antes de encerrar o emulador.
A existência dessas evidências nunca transforma falha em aprovação.
O relatório original da execução 4 permanece em
`docs/evidence/github-native-android-35309547794.json`.

## Rotina

`.github/workflows/native.yml` começa somente por acionamento manual. O campo
`platform` permite `android`, `ios` ou `all`; o campo `app` permite um Android
específico ou `all`. Para iOS, selecionar `all`. Usa runners temporários
Ubuntu 24.04 para Android e macOS 26 para iOS. Não publica
apps, não usa conta de loja, não contrata VPS e não executa integrações de negócio.
Antes de cada nova rodada, conferir a franquia restante e o bloqueio de gastos
na conta. O limite de tempo do job não substitui o limite financeiro.

Antes das compilações, um job de até cinco minutos verifica os subprocessos e
gera a matriz a partir do catálogo. São no máximo quatro jobs nativos simultâneos, cada um em seu próprio runner.
A compilação Android tem teto interno de 28 minutos, etapa de 30 e job de 35;
Gradle tem prazo próprio de 15 minutos. O teste Android usa outro runner, com
teto interno de 10 minutos, etapa de 12 e job de 15, reservando tempo para diagnóstico. iOS mantém os quatro apps juntos, com
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

Relatórios, imagens PNG e textos de tela têm retenção de três dias. O APK de
desenvolvimento e seu relatório de compilação são transferidos entre jobs como
artefato privado com retenção de um dia. O download falha se o digest divergir,
e o teste reconfere o hash do APK e sua origem. Não são enviados node_modules,
SDKs, caches, certificados ou chaves privadas. O APK temporário não é uma versão
assinada para distribuição; não é publicado nas lojas nem anexado ao código Git. Evidências selecionadas e revisadas devem ser preservadas
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

- [Transferência oficial de artefatos GitHub Actions](https://github.com/actions/download-artifact)
- [Comando de fechamento do keyguard no Android](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/wm/WindowManagerShellCommand.java)

## Diagnóstico do System UI — execução 35342349483

A compilação separada terminou em 8m48s. O APK foi transferido com hash conferido
e instalado. A abertura falhou: captura, hierarquia e janela em foco registraram
**System UI isn’t responding**, do próprio Android. O processo Cidadão permaneceu
vivo, mas sua tela não recebeu aprovação. Evidências originais estão em
`docs/evidence/native-35342349483/android/`.

O teste agora usa perfil explícito Pixel 2 e exige a tela inicial do Android
estável antes de instalar JeriFlow. Um ANR de System UI nessa preparação permite
exatamente uma reinicialização do dispositivo, com evidência preservada. Erros
do app e uma segunda falha não recebem recuperação nem aprovação automática.

Para diagnosticar o emulador sem recompilar, os dois campos opcionais
`build_run_id` e `build_commit` identificam o APK privado já compilado. Esse modo
exige Android, valida origem e hash de cada app e recusa mudanças nos arquivos
da aplicação ou dependências. O relatório distingue o commit do teste do commit
do APK. A verificação completa continua compilando os quatro apps com esses
campos vazios. Etapa 2 permanece aberta até a aprovação das oito aberturas Android.

A execução diagnóstica 35372117436 confirmou ANR de System UI antes da
instalação do app, com falhas do serviço UiAutomation e da captura. Não há
evidência suficiente para atribuir a falha apenas à memória. A preparação foi
ajustada para detectar ANR também nas janelas, mesmo sem acessibilidade, e
preservar essa evidência quando a captura não responde. O dispositivo mantém
Android 16/API 36, usa 4 GiB de RAM, tela 540×960 com 210 dpi (mesmo espaço
lógico do perfil), aceleração KVM obrigatória, animações de teste desativadas
e GLES sem Vulkan. Essas são configurações do emulador; não alteram o APK.
Apenas um novo resultado real pode aprovar essa configuração.

## Cidadão aprovado — execução 35372955675

O APK da execução 35342349483 foi instalado e abriu duas vezes com o teste
do commit `2b7046819f42ea451b81a4b53d8ac92bd979a229`. Capturas, hierarquia e
hashes foram conferidos. Android 16/API 36, x86_64, tela 540×960, 4 GiB;
**nenhuma reinicialização de recuperação foi necessária**. O mesmo binário
que falhou com o emulador anterior passou com a preparação corrigida. Isso
confirma o reparo desse cenário, sem prometer ausência universal de falhas.

A verificação dos quatro apps será executada com campos de reuso vazios.
São quatro runners simultâneos e independentes para reduzir a espera, dentro
da franquia conferida: 263,3/2.000 minutos e US$ 0 faturável antes do diagnóstico.
Não foram alterados plano ou bloqueio de gastos. Limites oficiais:
https://docs.github.com/en/actions/reference/limits

## Fechamento da preparação do Android

Encontradas duas fragilidades no teste: o comando uiautomator pode encerrar
sem gerar XML, deixando o arquivo da tentativa anterior; e falhas em alguns
comandos não reiniciavam a contagem de estabilidade da tela inicial. A captura
agora usa um nome exclusivo por leitura, recusa erros e XML ausente. O Android
precisa permanecer saudável por 30 segundos contínuos, com ao menos três
amostras e o mesmo processo System UI, conferido antes e depois de cada captura.
Qualquer falha reinicia a contagem. Isso evita instalar o app com uma leitura
antiga ou durante a preparação incompleta do sistema.

O reuso identificado pode verificar os quatro APKs da mesma execução já
compilada, mantendo a verificação de origem, identidade, fontes e hashes.
Não é necessário recompilar aplicativos para testar esse reparo do controlador.
A ressalva só será encerrada após confirmar o resultado desse fluxo na nuvem.
