#!/bin/bash
# Diagnóstico local. Não instala ferramentas nem pede senhas.
set -u
umask 077

if [[ "$(/usr/bin/uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'Este diagnóstico deve ser aberto no Mac que será usado para desenvolver o JeriFlow.'
  exit 1
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"
task_script_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)" || exit 1
task_report="$task_script_dir/JERIFLOW_DIAGNOSTICO_MAC_$(/bin/date +%Y%m%d_%H%M%S)_$$.txt"

report() {
  printf '%s\n' 'JeriFlow — diagnóstico do Mac' 'Objetivo: identificar ferramentas para a Etapa 2.'
  printf '%s\n' 'Não contém senhas, contas, número de série, arquivos pessoais ou variáveis de ambiente.' ''
  printf 'macOS: %s\n' "$(/usr/bin/sw_vers -productVersion)"
  printf 'Arquitetura do processo: %s\n' "$(/usr/bin/uname -m)"
  task_chip="$(/usr/sbin/sysctl -n machdep.cpu.brand_string 2>/dev/null)"
  printf 'Processador: %s\n' "${task_chip:-não identificado}"
  task_memory="$(/usr/sbin/sysctl -n hw.memsize 2>/dev/null)"
  if [[ "$task_memory" =~ ^[0-9]+$ ]]; then
    printf 'Memória: %s GiB\n' "$((task_memory / 1073741824))"
  fi

  if command -v node >/dev/null 2>&1; then
    printf 'Node: %s\n' "$(node --version 2>/dev/null)"
    if node -e 'const [m,n]=process.versions.node.split(".").map(Number);process.exit(m===24&&n>=15?0:1)' >/dev/null 2>&1; then
      printf '%s\n' 'Node compatível: SIM'
    else
      printf '%s\n' 'Node compatível: NÃO — requer série 24, a partir de 24.15.'
    fi
  else
    printf '%s\n' 'Node: comando não encontrado.'
  fi
  if command -v npm >/dev/null 2>&1; then
    printf 'npm local: %s\n' "$(npm --version 2>/dev/null)"
    printf '%s\n' 'A preparação do projeto usa npm 12.0.2 sem substituir o npm global.'
  else
    printf '%s\n' 'npm: comando não encontrado.'
  fi

  task_developer="$(/usr/bin/xcode-select -p 2>/dev/null)"
  if [[ -n "$task_developer" ]]; then
    printf '%s\n' 'Ferramentas de desenvolvimento Apple selecionadas: SIM'
    if command -v git >/dev/null 2>&1; then
      printf 'Git: %s\n' "$(git --version 2>/dev/null)"
    fi
  else
    printf '%s\n' 'Ferramentas de desenvolvimento Apple selecionadas: NÃO'
  fi
  if [[ "$task_developer" == *'.app/Contents/Developer' ]]; then
    task_xcode="$(/usr/bin/xcodebuild -version 2>/dev/null)"
    if [[ -n "$task_xcode" ]]; then
      printf '%s\n' "$task_xcode"
      task_ios_sdk="$(/usr/bin/xcrun --sdk iphonesimulator --show-sdk-version 2>/dev/null)"
      printf 'SDK do simulador iOS: %s\n' "${task_ios_sdk:-INDISPONÍVEL}"
    else
      printf '%s\n' 'Xcode selecionado, mas indisponível para comandos; precisa de revisão local.'
    fi
  else
    printf '%s\n' 'Xcode completo selecionado: NÃO (Command Line Tools isolado não compila iOS).'
  fi
  if command -v pod >/dev/null 2>&1; then
    printf '%s\n' 'CocoaPods: comando encontrado; execução será conferida na compilação.'
  else
    printf '%s\n' 'CocoaPods: comando não encontrado.'
  fi

  if command -v docker >/dev/null 2>&1; then
    printf 'Docker: %s\n' "$(docker --version 2>/dev/null)"
    task_compose="$(docker compose version --short 2>/dev/null)"
    printf 'Compose: %s\n' "${task_compose:-AUSENTE}"
    printf '%s\n' 'Este diagnóstico não inicia containers nem consulta um servidor Docker remoto.'
  else
    printf '%s\n' 'Docker/Compose: comando não encontrado.'
  fi

  task_adb="$(command -v adb 2>/dev/null)"
  if [[ -z "$task_adb" && -x "${ANDROID_HOME:-/nonexistent}/platform-tools/adb" ]]; then
    task_adb="${ANDROID_HOME}/platform-tools/adb"
  fi
  if [[ -z "$task_adb" && -x "${HOME}/Library/Android/sdk/platform-tools/adb" ]]; then
    task_adb="${HOME}/Library/Android/sdk/platform-tools/adb"
  fi
  if [[ -n "$task_adb" ]]; then
    # O restante da saída de adb contém caminho local: não incluí-lo no relatório.
    "$task_adb" version 2>/dev/null | /usr/bin/head -n 1
  else
    printf '%s\n' 'Android adb: comando não encontrado.'
  fi
  if /usr/libexec/java_home >/dev/null 2>&1; then
    printf '%s\n' 'Java: instalação detectada; compatibilidade será conferida no build Android.'
  else
    printf '%s\n' 'Java: instalação não detectada.'
  fi
  printf '\n%s\n' 'A Etapa 2 continua aberta até banco/cache, builds nativos e execução serem validados.'
  printf '%s\n' 'Envie este relatório ao assistente. Nenhum aplicativo foi publicado ou serviço contratado.'
}

# Não substituir um arquivo preexistente, mesmo em duas execuções simultâneas.
set -C
if report > "$task_report"; then
  /bin/cat "$task_report"
  printf '\n%s\n' 'Relatório criado na mesma pasta deste arquivo. Envie o arquivo JERIFLOW_DIAGNOSTICO_MAC ao assistente.'
else
  printf '%s\n' 'Não foi possível salvar o diagnóstico nesta pasta. Envie uma foto desta tela.'
  exit 1
fi
if [[ -t 0 ]]; then
  read -r -p 'Pressione Enter para fechar.' task_close
fi
