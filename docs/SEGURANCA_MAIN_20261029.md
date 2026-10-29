# Segurança da main — atualização mínima em29/10/2026

## Problema e escopo

A PR100 contém a revisão de segurança de27/10, mas está empilhada sobre a PR98 e sua cadeia funcional em desenvolvimento. Para tornar a manutenção da main revisável de forma independente, esta branch parte diretamente de `7a314c287823dc344c094b893178b500fc3777ab` e reaproveita apenas as correções de dependências e seus oito testes significativos já preservados na PR100.

Mudanças: Next16.3.5→16.4.3, bibliotecas nativas correspondentes; sharp transitivo0.35.4→0.35.5; node-forge1.4.0→1.4.2, shell-quote1.10.0→1.12.0, source-map-js1.2.1→1.2.2; Zod4.6.7 em override restrito à CLI do Expo57. Nenhum SDK móvel rebaixado ou regra funcional reinterpretada.

API, SQL/migrations, identidade, telas e identificadores dos apps, permissões e workflows continuam byte a byte iguais à base. Não incorpora PRs de negócio nem substitui as PRs99–101. Sem merge, deploy, dados reais ou publicação.

## Auditoria atual e achado ainda aberto

Relatórios `evidence/main-security-20261029/before.json` e `after.json`, ambos consultados em29/10:

- Baseline:13 pacotes sinalizados —2 critical,6 high,5 low.
- Após as correções:7 pacotes sinalizados —0 critical,0 high,7 low.

Os sete low decorrem de **um achado raiz no deepmerge4.3.1** e sua propagação por seis pacotes da cadeia Expo. Antes, Expo e CLI eram classificados em high por outros achados; por isso a contagem low muda sem significar duas vulnerabilidades novas introduzidas. A auditoria conta pacotes afetados, não sete bugs independentes.

[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), revisado em27/10, informa prototype poisoning e **nenhuma versão corrigida**. O registro npm oficial confirma latest4.3.1. O resultado zero alertas de27/10 permanece evidência histórica daquele momento, não garantia permanente. Não rebaixar Expo para51 sugerido automaticamente, suprimir o aviso ou reduzir o limiar low para aparentar aprovação.

Inspeção de alcance: `@expo/config/build/Config.js` usa deepmerge ao modificar config e propriedades de plugins; os apps atuais usam app.json estáticos e versionados. Não há import direto em apps/packages/scripts do JeriFlow nem rota de API identificada que receba dados externos e os envie à biblioteca. Isso limita o alcance observado à ferramenta de configuração/build; **não prova impossibilidade de exploração**. Manter configurações/plugins sob revisão e não importar config externa sem validação. Correção upstream compatível ou remediação própria revisada e testada ainda pendente antes da decisão de release.

## Validação

Instalação limpa pelo lockfile com npm12.0.2, sem scripts de terceiros. Tipagem de todos os workspaces PASS; **84/84 testes locais PASS**, incluindo os oito testes shell-quote e Expo/Zod reaproveitados. Esta main não contém os330 testes da linha funcional PR101; os escopos não podem ser somados ou confundidos.

Verificação de diff: somente manifests/lockfile, os dois arquivos de regressão e este registro/evidências. Nenhuma migração ou implementação de negócio copiada.

CI da base e identidade: pendente ao preparar o commit. A base mantém auditoria low e deverá reprovar enquanto os sete low persistirem; separar essa reprovação dos testes/builds/integrações. Não declarar I13 atualizado integralmente em29/10 como aprovado por causa dos resultados de27/10. F00 segue dependente das fontes originaisV5.16 e arquitetura, ainda indisponíveis nesta sessão.

## Reconferência da linha funcional

A auditoria somente dos manifests/lockfile da PR100 em29/10 também retornou7 low/0 high/0 critical, pela mesma cadeia deepmerge. O relatório `active-pr100-current.json` é consulta nova em cópia isolada, sem alterar a PR100. Sua execução40566863216 de27/10 permanece um resultado histórico válido, não o estado atual do registro npm. PR100 recebeu aviso atualizado no corpo; não repetidos builds/testes por essa reconferência de metadata.
