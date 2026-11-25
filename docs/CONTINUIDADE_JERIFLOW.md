# Continuidade JeriFlow — 25/11/2026

**Estado vigente em 25/11/2026.** O original V5.16 e a arquitetura foram recuperados. ZIP novamente validado: SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`. A falta da fonte registrada em outubro está resolvida. Main permanece `7a314c287823dc344c094b893178b500fc3777ab`; PRs103–116 conferidas abertas, em rascunho e sem merge.

V1: quatro APKs Android e PWA para iPhone/web, mantendo visual e regras V5.16. iOS nativo preservado e V2 visual futura. Sem merge/main, deploy, publicação ou dados reais sem autorização específica.

[CI45682078486](https://github.com/iansilva23/jeriflow-core/actions/runs/45682078486), commit `175b58f29d5c41e4e4952898387e4013e32afa74`, PR116: cinco jobs aprovados — compilação, PostgreSQL/ClamAV, Galeria, Arquivos e Câmera. Três emuladores confirmaram prévia, envio e protocolo com foto no banco. HEAD funcional atual `41db303fa88a9bc07a714dec107557dc2b4dfd4b`: [CI45686622888](https://github.com/iansilva23/jeriflow-core/actions/runs/45686622888) aprovado nos cinco jobs, incluindo os três caminhos até protocolo no PostgreSQL. Nove capturas (formulário, prévia e protocolo em cada caminho) tiveram seus hashes verificados; quatro artefatos não APK foram recuperados, com digest/CRC conferidos. Inspeção visual amostral confirma botões e prévia; não aprova paridade integral. A revisão f4af5ec falhou no CI45684479143 por fixture fora de escopo; essa falha e sua correção41db303, com quatro regressões novas, permanecem no histórico. O diagnóstico falho não foi usado como aprovação.

F02 parcial: visitante com posse segura, navegação/identidade original completa, paridade visual integral, PWA, ambiente persistente e aparelhos físicos seguem pendentes. Captura real do HTML original obtida localmente em 412×915 CSS px com estilos computados; bloqueio inicial de renderização resolvido com navegador de teste à parte. Não foi alterado o original. Capturas e artefatos brutos permanecem no pacote de continuidade, fora desta PR documental pública.

## Retomada técnica

1. Última prova funcional: CI45686622888 /41db303 aprovado; nove capturas validadas. Próximo recorte visual: legenda dinâmica da foto, dimensões, gradientes/tipografia, identidade e navegação originais. Capturas atuais são de trechos com rolagem, não aprovação da tela inteira.
2. Continuar F02 preservando conta cadastrada, município, protocolo canônico e vínculo seguro. deviceId local não comprova posse de visitante.
3. Entregar Prompt Mestre COMPLETO e pacote após cada mudança material. O r51 entregue no chat preserva original, histórico, código alterado e artefatos. O checkpoint de consolidação deve preservar a renderização original, a falha diagnosticada e o resultado aprovado com artefatos.
4. Não repetir autorização geral nem prometer execução em segundo plano após terminar a sessão. Dependências institucionais entram no momento necessário.

## Evidências anteriores preservadas

F00 técnica: PR103 cd842047/CI43479677905 e PR104 bf4a0ed1/CI43485049051, conforme pacote mestre. Revisão inicial dos245 controles não equivale à entrega dos245 controles. F01: PR105 a09710eb/CI43487183904, 52/52 identidade; homologação persistente pendente. Bloco4: CI37824466140, 43/0/0 histórico, sem repetição nesta atualização. I13: achado deepmerge de29/10 é histórico; não houve nova auditoria npm nesta revisão documental e não se afirma manutenção ou correção desse alerta.

## Cadeia remota conferida hoje

| PR | Branch | HEAD conferido | Base |
|---|---|---|---|
| [#103](https://github.com/iansilva23/jeriflow-core/pull/103) | `continuity/f00-v516-20261113` | `cd8420470d926b54f3c12c1c89fb8c4ba848d703` | `test/upload-rejection-macos-20261027` |
| [#104](https://github.com/iansilva23/jeriflow-core/pull/104) | `continuity/f00-android-20261113` | `bf4a0ed1c1956151449ac80d37e0ecb14de06f71` | `continuity/f00-v516-20261113` |
| [#105](https://github.com/iansilva23/jeriflow-core/pull/105) | `continuity/f01-accounts-20261113` | `a09710ebcbc01e797d66b7cbe44ff62d608624c3` | `continuity/f00-android-20261113` |
| [#106](https://github.com/iansilva23/jeriflow-core/pull/106) | `continuity/f02-guard-api-20261113` | `0eca3f70c192db68cefba887b2f3a03682b81aa4` | `continuity/f01-accounts-20261113` |
| [#107](https://github.com/iansilva23/jeriflow-core/pull/107) | `continuity/f02-private-photos-20261113` | `d87f0463212fffaae31b87ccdb7d3005df5dfc8d` | `continuity/f02-guard-api-20261113` |
| [#108](https://github.com/iansilva23/jeriflow-core/pull/108) | `continuity/f02-traffic-submit-20261113` | `cdb0afa4a47f952c5ef4c0d45ec92f886286a2d8` | `continuity/f02-private-photos-20261113` |
| [#109](https://github.com/iansilva23/jeriflow-core/pull/109) | `continuity/f02-citizen-link-20261113` | `673d0fe08f3d1907b4a98fec97641eb115d188fc` | `continuity/f02-traffic-submit-20261113` |
| [#110](https://github.com/iansilva23/jeriflow-core/pull/110) | `continuity/f02-citizen-link-api-20261113` | `6828671bbfda028daed51bf7cab9f1fa6bd2d555` | `continuity/f02-citizen-link-20261113` |
| [#111](https://github.com/iansilva23/jeriflow-core/pull/111) | `continuity/f02-citizen-link-app-20261113` | `73a184d1889d0f8f3c055d9288d15e1d463c4bec` | `continuity/f02-citizen-link-api-20261113` |
| [#112](https://github.com/iansilva23/jeriflow-core/pull/112) | `continuity/f02-citizen-traffic-app-20261113` | `f2f90fc63578099a5848f2943f8c6f962676877d` | `continuity/f02-citizen-link-app-20261113` |
| [#113](https://github.com/iansilva23/jeriflow-core/pull/113) | `continuity/f02-citizen-guard-proof-20261113` | `195ebe5b7b760d6ce2f5ffcaa36427d5ece05fba` | `continuity/f02-citizen-traffic-app-20261113` |
| [#114](https://github.com/iansilva23/jeriflow-core/pull/114) | `continuity/f02-citizen-apk-smoke-20261113` | `4364e81aa3b0dffdcfc0724f2c32e2c9b97a3349` | `continuity/f02-citizen-guard-proof-20261113` |
| [#115](https://github.com/iansilva23/jeriflow-core/pull/115) | `continuity/f02-citizen-form-v516-20261113` | `876eefbe56ff2fab5f228f29d38aa6dd37438d66` | `continuity/f02-citizen-apk-smoke-20261113` |
| [#116](https://github.com/iansilva23/jeriflow-core/pull/116) | `continuity/f02-citizen-traffic-e2e-20261114` | `41db303fa88a9bc07a714dec107557dc2b4dfd4b` | `continuity/f02-citizen-form-v516-20261113` |

## Histórico

Registro anterior integral: [CONTINUIDADE_20261029.md](evidence/continuity-20261125/CONTINUIDADE_20261029.md). Ausência de fontes e estados antigos ali descritos são históricos. Os documentos desta branch organizam o projeto; não incorporam a cadeia funcional na main. Nenhuma branch apagada ou reescrita.
