# Mapa geral JeriFlow

Checkpoint: 27/10/2026. **F00 em execução; preservação do CI da F01 concluída como subentrega. Fases integrais não fechadas.**

## Estado conciliado

Main `7a314c287823dc344c094b893178b500fc3777ab` permanece na base técnica aprovada. Até esta retomada: 98 PRs, 84 abertas (todas em rascunho), 14 fechadas, zero merges. Linha ativa mais recente: PR98 `98b627c26448ab8505e5cfffe1ec2fb50d2d590f`. PR93 segue ramo próprio: não é automaticamente substituída pela PR98. Preservados todos os ramos; nenhuma migração aplicada, nenhum reset, merge, deploy ou alteração de produto nesta retomada.

[68 itens classificados](MATRIZ_RASTREABILIDADE_JERIFLOW.md): {'BLOQUEADO POR DEPENDÊNCIA': 13, 'APROVADO NO ESCOPO': 7, 'EM IMPLEMENTAÇÃO': 24, 'PENDENTE': 23, 'A CONFERIR': 1}. Estados não são porcentagem de conclusão. Os sete itens aprovados são H02–H08 no escopo técnico do CI; não fecham os domínios.

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
