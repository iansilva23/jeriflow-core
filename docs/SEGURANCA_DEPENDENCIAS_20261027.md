# Dependências — revisão de segurança em 27/10/2026

**Estado mais recente: revisão aprovada no escopo do CI em `d89d2483287d58ac6e8d3645ecfcd2193643303e`, auditoria zero alertas e oito verificações aprovadas.** As seções seguintes preservam também os resultados anteriores de8 e3 alertas; não representam o lockfile final. A diferença de resposta de upload no macOS segue registrada como ressalva de regressão/Q05, sem alteração de teste ou limite. Não há liberação de produção ou aprovação de todo o ecossistema.

Trabalho independente de segurança (I13/I11), autorizado pelo prompt mestre e pela reiteração do usuário. Não muda funcionalidades nem substitui a F00 ainda aberta. Base: PR98, commit `98b627c26448ab8505e5cfffe1ec2fb50d2d590f`. Preserva a cadeia funcional em rascunho; não incorpora nada na main.

## Problema e correção parcial

A auditoria npm12.0.2 dos lockfiles da main e da PR98 encontrou oito pacotes sinalizados: seis high e dois critical. São classificações do registro, não prova de exploração no aplicativo. Os relatórios originais de antes/depois ficam em `evidence/dependencies-20261027/`.

| Pacote | Antes | Depois | Motivo |
|---|---|---|---|
| next |16.3.5|16.4.3|Correções de execução remota, cache e outras falhas publicadas pelo mantenedor|
| sharp |0.35.4|0.35.5|Correção na dependência librsvg; bibliotecas nativas correspondentes atualizadas|
| node-forge |1.4.0|1.4.2|Validação de assinatura RSA corrigida, dentro da faixa já permitida pelo Expo|
| shell-quote |1.10.0|1.12.0|Rejeita terminador de linha em token posterior a comentário|
| source-map-js |1.2.1|1.2.2|Correção de negação de serviço em offsets de mapa indexado|

Depois: **zero critical e três high**, todos na cadeia Expo→CLI→Zod. Não há autorização técnica implícita para forçar Zod3→4 ou rebaixar Expo57→54 só para limpar a auditoria. A sugestão automática de downgrade não foi aplicada. SDK móvel, React, React Native, identidade, SQL e regras de domínio permanecem inalterados. Não há alegação de segurança completa ou aprovação de produção.

## Validação local

Node24.22.1 e npm12.0.2. Instalação limpa pelo lockfile, sem scripts de instalação de terceiros. Alterações de versões conferidas individualmente, limitadas aos cinco pacotes e suas bibliotecas correspondentes.

- Tipagem do projeto e de todos os workspaces: PASS.
- Compilação do administrativo Next16.4.3: PASS.
- HTTP do administrativo: login público, índice/sete painéis/TTS/gestão protegidos e rotas inválidas: PASS.
- Oito bundles Android/iOS dos quatro apps: PASS. Não são APK/IPA, teste nativo ou teste físico.
- Regressão shell-quote: a versão antiga aceita o padrão inseguro; a corrigida lança TypeError. Nenhum comando gerado é executado. Dois testes também conferem preservação de argumentos literais.
- Suíte local integral da base antes de adicionar os dois testes de regressão: **320 PASS /1 FAIL /0 SKIP**. Única falha: teste de upload acima de8MiB recebe ECONNRESET no macOS enquanto espera HTTP413. Fonte do handler e teste não alterados por esta atualização. Não removido/relaxado o limite nem filtrado o cenário. CI Linux com Node24.19.0 preparado para verificar o comportamento no ambiente já usado pelo projeto. Não assumir causa definitiva sem essa evidência.
- Uma tentativa anterior no ambiente restrito teve falhas EPERM ao abrir sockets; não é resultado de produto. A repetição permitiu executar a suíte acima.

## CI e pendências

Serão reutilizados os workflows existentes `check.yml` (suíte completa, tipagem, painel, oito bundles, auditoria e infraestrutura) e `v516-regressao-consolidada-pos-native.yml` (regressão e login real com PostgreSQL/Redis/Mailpit). A etapa de auditoria **continua falhando enquanto houver alertas**, com o limiar original low preservado. Resultado remoto ainda pendente na preparação deste commit.

A conexão OAuth recusou criar um workflow novo por ausência do escopo workflow. O arquivo novo foi retirado do único commit local não publicado; nenhum workflow foi criado/modificado nem permissão ampliada. A validação usa somente automações já presentes e disponíveis.

I13 permanece EM IMPLEMENTAÇÃO: é necessário tratar a cadeia Zod/Expo por solução compatível e comprovada, resolver/classificar qualquer falha de regressão e revisar a PR antes de integrar. O patch de dependências só existe nesta branch; a main ainda possui as versões anteriores.

Referências primárias: [Next advisory](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr), [shell-quote advisory](https://github.com/ljharb/shell-quote/security/advisories/GHSA-pqg4-j6r4-53mv), [npm audit](https://docs.npmjs.com/cli/v12/commands/npm-audit/). Não afirmar paridade de negócio a partir desta mudança de segurança.

## Resultado remoto já confirmado

No SHA `7cd33a474d72e6b95458eb08f718304cfaaff8fe`:

- Regressão [40564692967](https://github.com/iansilva23/jeriflow-core/actions/runs/40564692967): **SUCCESS**,323 testes locais PASS/0 FAIL/0 SKIP, tipagem PASS;1 teste integrado composto de login/atendimento com banco real e12 cenários de autorização/reenvio também PASS. O caso de upload8MiB passou no Linux/Node24.19 sem alteração no teste/limite; a falha macOS permanece registrada, sem diagnóstico conclusivo.
- Base [40564688873](https://github.com/iansilva23/jeriflow-core/actions/runs/40564688873): **FAILURE**, com7 de8 verificações aprovadas. Tipagem/testes, build/admin HTTP, oito bundles, árvore de dependências, configuração e bancos PASS. Única reprovação: auditoria3 high/0 critical, sem ignorar alertas. Original `foundation-report.json` preservado. SHA256 do ZIP de origem: `48615d6cd85ed6ca43dbe756a53a076ab89b10a7a4ec4080d0ade275319ec246`, artefato12762591735.

Validações complementares concluídas no mesmo SHA de código:

- Pipeline de fotografia [40565043889](https://github.com/iansilva23/jeriflow-core/actions/runs/40565043889): **SUCCESS**,14/14 cenários com PostgreSQL e ClamAV reais, mais grupos8/8,26/26 e8/8 de pipeline/HTTP/contrato/scanner. Assinaturas e imagens sintéticas; não é nova verificação de bases oficiais em VPS.
- Identidade [40565265097](https://github.com/iansilva23/jeriflow-core/actions/runs/40565265097): **SUCCESS**,323/323 testes locais e **52/52 cenários integrados** de identidade, sessões/BFF, email/MFA, gestão/municípios com PostgreSQL/Redis/Mailpit. Não é interação no aparelho nem navegador. Original `identity-report.json` preservado; ZIP de origem SHA256 `807e06844467d4365e19ca98a7ea99691d17b924d5ec68c041a7c7f8f9d1118f`, artefato12763355653.

Os commits posteriores a `7cd33a4` apenas registram relatórios/documentação; manifests, lockfile e teste de regressão são os mesmos executados. Não repetir baterias por essas notas. **I13 permanece EM IMPLEMENTAÇÃO**, por3 high ainda abertos e pela classificação final da diferença macOS/Linux. Não liberar produção nem afirmar ecossistema completo.

## Continuação: correção compatível da cadeia Expo/Zod

Em27/10 foi investigada a pendência em vez de silenciá-la. A CLI57.0.25 usa Zod em dois arquivos de schemas: `DevToolsPlugin.schema.js` e `createMCPDevToolsExtensionSchema.js`. O consumidor `MCPDevToolsPluginCLIExtensions.js` registra os schemas e usa `error.issues`; essas operações foram exercitadas diretamente nos novos testes. Não foi atualizado o SDK Expo nem React Native.

Foi aplicado override **restrito à dependência Zod da @expo/cli** para4.6.7, após comparar o guia oficial de migração e testar os contratos realmente utilizados. Não é uma substituição global de bibliotecas de aplicação nem autorização para futuras versões principais sem novos testes.

Os cinco testes de compatibilidade passaram antes e depois: descritor válido e remoção de campos extras, rejeição de plugins inválidos/erros legíveis, saídas texto/imagem/áudio, parâmetros primitivos/enum/chaves estritas e registro exclusivo de comandos habilitados para MCP. Um sexto teste reproduz o problema de consumo excessivo: array com limite2 e3 elementos realiza3 transformações na versão3.25.76; na4.6.7 rejeita antes e realiza0. O teste usa três strings sintéticas, sem teste de exaustão real.

A primeira resolução manteve Zod3 apesar do override; o teste falhou corretamente e `npm explain` confirmou3.25.76. `npm update zod --package-lock-only` resolveu4.6.7 e instalação limpa confirmou a versão carregada pela CLI. Não bastou alterar o manifest.

**Auditoria local posterior:0 vulnerabilidades de qualquer nível.** Resultado pontual do registro npm; não certifica ausência de falhas. Tipagem PASS e seis novos testes PASS; a suíte completa macOS continua com a mesma falha ECONNRESET no teste8MiB, sem mudança no teste/servidor. Builds/CI desta nova resolução ainda em validação. Os3 alertas descritos nas seções anteriores são históricos dos commits anteriores, não o estado deste lockfile candidato.

Limite: testes exercitam os consumidores reais e a fronteira de registro da CLI; não atestam sessão com servidor MCP externo/plugin de terceiros, nem build nativo/aparelho físico. JeriFlow não adicionou esses serviços nesta mudança. Fonte oficial de alterações: https://zod.dev/v4/changelog e versão https://github.com/colinhacks/zod/releases/tag/v4.6.7.

## Fechamento da subentrega de revisão de dependências

Execução [40566863216](https://github.com/iansilva23/jeriflow-core/actions/runs/40566863216) **SUCCESS**, código `d89d2483287d58ac6e8d3645ecfcd2193643303e`, lockfile comprovado no relatório original `zod/foundation-report.json`. **8 PASS /0 FAIL /0 BLOCKED** nas verificações da base: tipagem/suíte completa, build administrativo, HTTP protegido, oito bundles móveis, árvore de dependências, auditoria, configuração local e PostgreSQL/Redis. A auditoria manteve o limiar low e informou zero vulnerabilidades. ZIP de origem SHA256 `63a36db2b6d088d640853de0a430440eed70e3219a6818714c0b81cc9b06c511`, artefato12764395488.

A suíte integral local contém329 testes, com328 PASS e1 FAIL na mesma diferença ECONNRESET macOS já registrada. O CI registra `npm run check` aprovado; este workflow preserva somente relatório agregado, não publica o TAP com contagem individual. Os seis cenários novos de compatibilidade/regressão passaram localmente e pertencem à suíte sem filtros executada no CI. Não foi repetida uma suíte já aprovada apenas para gerar novo log.

I13 **APROVADO NO ESCOPO: revisão de dependências de27/10 nesta branch e no CI indicado**, sem garantia permanente nem automatização periódica configurada. Reavaliar em atualizações futuras. PR100 continua DRAFT e main sem as correções até integração revisada. A fonte V5.16/arquitetura ausente continua bloqueando o fechamento F00 e mudanças funcionais dependentes. Nenhum servidor MCP externo ou aparelho físico foi homologado nesta revisão.
