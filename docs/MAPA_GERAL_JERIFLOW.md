# Mapa geral JeriFlow

**Estado vigente em 25/11/2026.** O original V5.16 e a arquitetura foram recuperados. ZIP novamente validado: SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`. A falta da fonte registrada em outubro está resolvida. Main permanece `7a314c287823dc344c094b893178b500fc3777ab`; PRs103–116 conferidas abertas, em rascunho e sem merge.

V1: quatro APKs Android e PWA para iPhone/web, mantendo visual e regras V5.16. iOS nativo preservado e V2 visual futura. Sem merge/main, deploy, publicação ou dados reais sem autorização específica.

[CI45682078486](https://github.com/iansilva23/jeriflow-core/actions/runs/45682078486), commit `175b58f29d5c41e4e4952898387e4013e32afa74`, PR116: cinco jobs aprovados — compilação, PostgreSQL/ClamAV, Galeria, Arquivos e Câmera. Três emuladores confirmaram prévia, envio e protocolo com foto no banco. HEAD funcional atual `41db303fa88a9bc07a714dec107557dc2b4dfd4b`: [CI45686622888](https://github.com/iansilva23/jeriflow-core/actions/runs/45686622888) aprovado nos cinco jobs, incluindo os três caminhos até protocolo no PostgreSQL. Nove capturas (formulário, prévia e protocolo em cada caminho) tiveram seus hashes verificados; quatro artefatos não APK foram recuperados, com digest/CRC conferidos. Inspeção visual amostral confirma botões e prévia; não aprova paridade integral. A revisão f4af5ec falhou no CI45684479143 por fixture fora de escopo; essa falha e sua correção41db303, com quatro regressões novas, permanecem no histórico. O diagnóstico falho não foi usado como aprovação.

F02 parcial: visitante com posse segura, navegação/identidade original completa, paridade visual integral, PWA, ambiente persistente e aparelhos físicos seguem pendentes. Captura real do HTML original obtida localmente em 412×915 CSS px com estilos computados; bloqueio inicial de renderização resolvido com navegador de teste à parte. Não foi alterado o original. Capturas e artefatos brutos permanecem no pacote de continuidade, fora desta PR documental pública.

## Cadeia vigente

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

F00: verificações técnicas registradas e fonte recuperada. F01: CI de contas no escopo da PR105; ambiente persistente pendente. F02 parcial conforme prova acima. F03–F11 preservam as revisões por requisito até nova evidência.

## Registro histórico de29/10/2026

Inventário de98 PRs e pendências de fonte ausente abaixo são fotografias antigas; o ponto vigente acima prevalece.

**Estado vigente em29/10/2026:** F00 continua aberta pelas fontes primárias indisponíveis. PR99 mantém a continuidade; PR100 tem correções na linha funcional, PR101 encerrou a diferença do teste de upload e PR102 prepara manutenção mínima diretamente na main. Todas em DRAFT, sem merge/deploy. A auditoria atual informa7 low ligados a um único achado raiz deepmerge, sem correção publicada; zero alertas de27/10 é evidência histórica. I13 voltou a EM IMPLEMENTAÇÃO para a revisão atual. Os trechos abaixo conservam a evolução histórica.


Checkpoint: 27/10/2026. **F00 em execução; preservação do CI da F01 concluída como subentrega. Fases integrais não fechadas.**

## Estado conciliado

Main `7a314c287823dc344c094b893178b500fc3777ab` permanece na base técnica aprovada. Até esta retomada: 98 PRs, 84 abertas (todas em rascunho), 14 fechadas, zero merges. Linha ativa mais recente: PR98 `98b627c26448ab8505e5cfffe1ec2fb50d2d590f`. PR93 segue ramo próprio: não é automaticamente substituída pela PR98. Preservados todos os ramos; nenhuma migração aplicada, nenhum reset, merge, deploy ou alteração de produto nesta retomada.

[68 itens classificados](MATRIZ_RASTREABILIDADE_JERIFLOW.md): {'BLOQUEADO POR DEPENDÊNCIA': 13, 'APROVADO NO ESCOPO': 7, 'EM IMPLEMENTAÇÃO': 25, 'PENDENTE': 22, 'A CONFERIR': 1}. Estados não são porcentagem de conclusão. H02–H08 estão aprovados no escopo técnico do CI e I13 na revisão pontual de dependências; isso não fecha os domínios.

## Ordem e critérios

| Fase | Situação desta retomada | Próximo critério |
|---|---|---|
| F00 | EM EXECUÇÃO | Recuperar ZIP V5.16/arquitetura oficial, conferir versão atual e terminar paridade; inventário de 68 e 98 PRs preparado |
| F01 | PARCIAL: CI preservado | GitHub é o ambiente atual por orientação do usuário; VPS adiada. Fechamento integral da F01 original exige VPS identificada/testada |
| F02 | EM IMPLEMENTAÇÃO em PRs existentes | Consolidar contratos/persistência/autorizações/anexos sem colisões; nenhuma promoção automática dos rascunhos |
| F03 | EM IMPLEMENTAÇÃO em PRs existentes | Integrar Cidadão, Guarda e painéis sobre protocolo canônico; apoio nativo ainda sem toque interativo homologado |
| F04 | EM IMPLEMENTAÇÃO parcial | Integrar cadastro/recebimentos/voucher e exceções ao painel, mantendo registro manual conforme fonte confirmada |
| F05 | PENDENTE | TTS, Fiscal, QR e modalidade/autoridade explícitas |
| F06 | EM IMPLEMENTAÇÃO parcial | Chave Turista tem backend privado; viagem/transporte/chat/interface pendentes |
| F07 | PENDENTE | Conteúdo PT/EN e atendimento; fornecedor IA exige decisão específica |
| F08 | PENDENTE | Notificações/serviços externos por acesso próprio; mocks não fecham integração |
| F09 | PENDENTE com componentes parciais | Studio, Dashboard, Mestre operacional e moderação integrados |
| F10 | PENDENTE | Quatro apps e aparelhos físicos com fluxos completos |
| F11 | PENDENTE com testes parciais | Segurança/carga/restauração/alertas comprovados |
| F12 | PENDENTE | Formalizações validadas pelos responsáveis |
| F13 | PENDENTE | Piloto autorizado e aceite |
| F14 | PENDENTE | Quatro pacotes de distribuição e titularidade |
| F15 | PENDENTE | Implantação/publicação especificamente autorizadas e operação entregue |

## Divergências que não podem ser perdidas

1. A PR2 foi fechada por auditoria de paridade após a execução verde do Bloco4. Evidência técnica preservada não é aprovação funcional V5.16. O prompt atual preserva identidade/MFA/convite seguro aprovados: **não substituir login nem remover MFA** por uma nota histórica. Reconciliação funcional detalhada depende do original.
2. PRs1–14 fechadas não são entregas atuais aprovadas. Em particular, filas genéricas, editor de tarifa e conciliação simulada não devem voltar ao produto sem regra aprovada. Não há merge de nenhuma delas.
3. Colisões reais nas migrations004–010 entre histórico rejeitado e linha V5.16; 001–003 são idênticas. [Hashes por linha](evidence/continuity-20261027/migration-inventory.json). Não aplicar SQL misturado ou renumerar às cegas.
4. `main.ts` da main e da PR98 injeta somente identidade e preserva bloqueio de produção/readiness. Componentes privados/preview não são API operacional publicada.
5. O SHA `89b8ff...08fad` do protótipo consta de auditorias históricas; o ZIP original não foi recuperado nesta sessão. Não afirmar versão/checksum atuais conferidos.
6. Última execução PR98 [38961141027](https://github.com/iansilva23/jeriflow-core/actions/runs/38961141027) success; consulta de artefatos retorna lista vazia em27/10. Metadados disponíveis não substituem capturas perdidas. Não reexecutado apenas para reconstruir resultado.

## Fila de dependências humanas e acesso

| Decisão/acesso | Necessário antes de | Quem resolve | Preparado / situação |
|---|---|---|---|
| ZIP original V5.16 (versão atual) e arquitetura oficial V1 | Fechar F00 e alterar funcionalidade dependente | Ian disponibiliza arquivo/acesso de biblioteca utilizável; agente verifica | Referências libfile e versão no prompt; buscas locais/Git sem original. Chats retornam referências, sem texto integral das respostas. Ferramenta não oferece biblioteca e acesso à UI do próprio app é recusado |
| VPS exclusiva JeriFlow | Fechar F01 integral / usar celular remoto | Ian escolhe quando necessário | **Adiada em27/10**: usuário informou que por enquanto tudo é GitHub; nenhuma contratação/acesso a outro projeto |
| Cobrança/estorno e papéis | Fechar F04 | Órgão/operador com Ian | Auditoria secundária indica recebimento manual; validar fonte antes de mudanças, sem gateway presumido |
| Modalidade e autoridade TTS | Fechar F05 | Órgão/Ian | Especificação manual/oficial pendente; não alegar integração oficial |
| Email/push/WhatsApp/IA externos | Ativar integração correspondente | Titular e Ian | Testes/adapters até acesso e autorização específicos; não enviar email externo |
| Android/iPhone e operador | F10 | Ian/operador | Roteiros virtuais preservados; sem aceite físico |
| Privacidade, operação, contratos e suporte | Piloto/dados reais | Responsáveis habilitados | Anexo B preservado como sete frentes formais, sem aceite implícito |
| Contas de lojas, assinatura e produção | F14/F15 | Titular/Ian | Preparar pacotes antes da ação final; autorização geral atual não é contratação/publicação |

## Entregas formais (fora da contagem dos 68)

L01 mapa de dados/finalidades/responsáveis; L02 privacidade/termos/retenção/titulares; L03 incidentes; L04 autoridade TTS/estacionamento; L05 fornecedores/região/titularidade; L06 SLA/custos/contratos; L07 treinamento/operação/suporte. Todas PENDENTES de preparação e validação competente. Nenhuma conclusão técnica supre aceite jurídico/operacional.

## Atualização independente — segurança em27/10

Após Ian reiterar a execução autônoma, foi tratada a frente I13 independente das fontes funcionais ausentes. PR100 (https://github.com/iansilva23/jeriflow-core/pull/100), branch `security/dependencies-20261027`, commit `7cd33a474d72e6b95458eb08f718304cfaaff8fe`, base PR98. Patch de Next/sharp e três transitivas reduziu8 alertas para3 high, sem critical. Mantidos Expo57, regras, identidade, SQL e main. Tipagem, painel e oito bundles passaram localmente; suíte320 PASS/1 FAIL por ECONNRESET de upload acima do limite. Duas regressões novas de shell-quote passaram, padrão inseguro demonstrado na versão anterior sem executar comandos.

CI em andamento:40564688873 (base completa com auditoria) e40564692967 (suíte/login PG). Não ignorar os3 high para obter PASS. Criação de workflow novo recusada por falta de escopo OAuth; arquivo retirado e reutilizados somente workflows existentes, sem ampliar permissões. Total de PRs após as duas novas:100; inventário original98 permanece histórico.

### Resultado final desta rodada independente

PR100 atualizada com evidências;323/323 testes,52/52 cenários de identidade e14/14 de pipeline real PASS. Tipagem, painel protegido e oito bundles PASS. A base geral teve7/8 verificações PASS e1 FAIL exclusivamente pela auditoria dos3 high não resolvidos. Zero critical na nova consulta, sem alegação de segurança total. Código testado7cd33a4; HEAD documental PR100 c1cd2f4. Todas as quatro execuções encerradas, sem tarefa em segundo plano. I13 permanece EM IMPLEMENTAÇÃO e F00/F01 integrais continuam abertas.

## Atualização vigente: dependências sem alertas no CI

A continuação resolveu os3 achados Expo/Zod com override restrito à CLI, mantendo Expo57. Seis testes exercitam os consumidores reais e a correção de rejeição antecipada de coleções. Execução40566863216 SUCCESS no código d89d248:8 PASS/0 FAIL/0 BLOCKED nas verificações da base e auditoria0 alertas, com limiar low preservado. Relatório original e SHA no fechamento da PR100, HEAD documental cbedd08. I13 APROVADO NO ESCOPO de revisão em27/10; periodicidade automática não configurada. As notas anteriores de3 alertas são históricas.

Ressalva Q05: no macOS a suíte329 testes tem328 PASS/1 FAIL por ECONNRESET no upload8MiB; suíte integral PASS no CI Linux sem alterar esse teste. Investigar diferença antes de homologação local, sem reduzir limite ou aceitar erro no lugar do413. F00 continua aguardando fontes originais; nenhuma fase integral fechada ou mudança de negócio inferida. A tentativa de obter os originais pelo navegador não respondeu e terminou sem recuperar arquivos; não repetir acesso travado como se houvesse conteúdo.

## Estado vigente após PR101

A ressalva de upload do Mac foi resolvida no teste:330/330 testes completos PASS no Mac e Linux, CI40614992068, código8391d14, PR101 DRAFT baseada na PR100. Sem alteração da API/limite. Os registros anteriores de falha são históricos e foram preservados. Q05 global permanece parcial. Agora são101 PRs no histórico (inventário98 foi a fotografia inicial, acrescida das PRs99,100 e101). Nenhum merge/deploy.

Feito antes: base de quatro apps, identidade/cadastro/gestão de contas e validação virtual. Feito nesta retomada: evidências do CI recuperadas,68 requisitos reconciliados, auditoria de dependências corrigida a0 alertas no CI, teste multiplataforma ajustado e continuidade durável nas PRs99–101. Faltam os fluxos operacionais completos e painéis, integrações, homologação física, capacidade/recuperação, formalizações, piloto e distribuição/implantação autorizadas conforme fasesF02–F15. F00/F01 integrais permanecem abertas; a dependência imediata é recuperar fontes originais acessíveis.
