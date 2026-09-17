# Testes executados no GitHub — Etapa 2 aberta

Atualização: 17/09/2026. Houve execução remota; não houve contratação de VPS.
A conexão de conta, a instalação do conector e o acesso de escrita ao repositório
privado iansilva23/jeriflow-core foram confirmados. A franquia de uso e o bloqueio
de gastos extras foram conferidos na conta antes do disparo, sem alterar cobranças
ou contratar planos. Nenhum dado real foi usado nos testes.

## Histórico e evidências

| Execução | Commit testado | Resultado |
| --- | --- | --- |
| [1 — 35221043184](https://github.com/iansilva23/jeriflow-core/actions/runs/35221043184) | 54d7925486090fd68203a1de531080a25294c000 | Falha na integração com a infraestrutura; sete verificações aprovadas. |
| [2 — 35221754364](https://github.com/iansilva23/jeriflow-core/actions/runs/35221754364) | 7d902e7dc7f28ae75f240b4aa964e681eeaf169a | Oito verificações aprovadas; job completo aprovado, incluindo bancos reais. |
| [3 — 35222197781](https://github.com/iansilva23/jeriflow-core/actions/runs/35222197781) | 6010e24219f132850060f14d401acf193692e9af | Oito verificações aprovadas; 27 testes, bancos reais e Actions atualizadas aprovados. |

A execução 3 é a última bateria completa da base do servidor e de seu workflow.
Todos os passos do job, inclusive encerramento dos serviços e envio do relatório,
terminaram com sucesso. O auditor de dependências registrou zero alertas conhecidos
naquele momento; isso não equivale a garantia de ausência de vulnerabilidades.

Os arquivos docs/evidence/github-actions-<execução>.json preservam o conteúdo
do relatório baixado, commit, URL, conclusão do job, identificação do artefato
e seu checksum. O checksum dos ZIPs baixados foi comparado ao informado pelo GitHub.
O relatório da primeira falha foi preservado; não foi reescrito como sucesso.

Foi corrigido um erro de inicialização PostgreSQL: trim(text), sem informar os
caracteres, remove espaços, mas não o LF final gravado no arquivo de secret.
A senha criada no banco ficava diferente da usada pela API. A inicialização agora
remove LF/CRLF nas bordas com `btrim(..., E'\r\n')` e rejeita valores fora do
formato hexadecimal esperado. A conexão real da execução 2 confirmou a correção.
Essa alteração não reinicializa volumes existentes nem apaga dados. O ambiente
do GitHub é temporário e cada execução prepara bancos e credenciais novos.

O diagnóstico aprovado verifica PostgreSQL com papel sem privilégios de
administrador, escrita/leitura em tabela temporária e rollback; Redis com
autenticação, PING, escrita/leitura temporária e remoção da chave de teste.
Os serviços também foram encerrados com sucesso ao final.

## Rotina reproduzível

O arquivo .github/workflows/check.yml define uma execução iniciada manualmente,
em uma máquina Ubuntu 24.04 temporária. Nenhum push ou pull request a inicia.
Uma execução tem limite de 20 minutos; execuções da mesma referência não se
sobrepõem. Isso limita consumo, mas não é um limite financeiro da conta.
As três Actions oficiais foram atualizadas para Node 24 e fixadas por commit
verificado, substituindo as versões v4 que emitiram aviso de descontinuação.
As permissões continuam limitadas a leitura de conteúdo; o checkout não persiste
credenciais. Dois testes adicionais protegem esses controles e a publicação
restrita ao relatório novo. A execução 3 confirmou o funcionamento dessa atualização
e não apresentou o aviso anterior de runtime Node 20 descontinuado.

A rotina instala pelo lockfile com Node 24.19.0 e npm 12.0.2, inicia os containers
PostgreSQL/Redis com credenciais descartáveis e chama npm run verify. Essa bateria
testa o código, as rotas administrativas, gera oito bundles, verifica dependências
e executa as operações de integração com os bancos reais. Uma falha deixa o job
reprovado. Os serviços recebem o comando de parada também depois de falhas.

Antes de começar, o relatório antigo é removido apenas da cópia temporária do
runner. Assim ele não pode ser publicado como evidência de uma execução nova.
O relatório novo, quando gerado, é guardado por três dias com commit, execução
e tentativa no nome do artefato. Credenciais, pastas de segredos e logs completos
não são enviados como artefatos. O status do job e de todos os passos deve ser
conferido junto com o relatório: um relatório parcial não aprova a bateria.

Se a preparação dos containers falhar, a bateria ainda tenta executar e registra
a indisponibilidade; a falha anterior continua reprovando o job. Se a instalação
falhar, a bateria não é iniciada. Uma execução interrompida não é aprovação.

## Procedimento para próximas execuções

1. Confirmar que o repositório informado pertence à conta correta e é privado.
2. Confirmar acesso de escrita, enviar somente arquivos versionados e preservar
   qualquer conteúdo anterior que não pertença a esta base.
3. Conferir Actions habilitado, permissões de workflow e os limites de uso/cobrança.
4. Iniciar a execução manual quando houver acesso ao disparo. Se a integração
   não oferecer esse comando, orientar um único clique em Actions >
   Verificacoes da base > Run workflow; não pedir tokens no chat.
5. Ler o resultado, jobs, passos e relatório; corrigir falhas e repetir somente
   o necessário. Registrar a URL da execução e o commit efetivamente verificado.

A conta conectada não dá automaticamente acesso ao navegador, à criação de
repositórios ou a todas as configurações de cobrança. Esses limites devem ser
conferidos pelas ferramentas disponíveis, sem presumir acesso.

## Limites desta rotina

O workflow check.yml não compila APK/AAB/IPA, não inicia simulador iOS, não faz
testes em celulares nem publica nas lojas. A rotina adicional native.yml foi
executada: quatro apps e oito aberturas iOS aprovados. O Android excedeu o prazo
na primeira tentativa; a correção e a nova validação estão registradas separadamente.
Consulte [VALIDACAO_NATIVA.md](VALIDACAO_NATIVA.md). O relatório original da bateria
da base mantém stage2Closed como false; ele não avalia os critérios nativos.
A infraestrutura de testes é temporária; não é hospedagem do produto.

O arquivo docs/VERIFICATION.json permanece sendo a evidência
da execução LOCAL de 16/09/2026. Não foi trocado por uma simulação de resultado
do GitHub. As evidências remotas ficam separadas em docs/evidence/ e identificam
exatamente o commit verificado. Alterações posteriores apenas nos relatórios e
na documentação não significam que um novo código de execução foi testado.

## Referências

- [Execução manual](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [Máquinas hospedadas](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)
- [Artefatos e retenção](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [Normalização de texto no PostgreSQL](https://www.postgresql.org/docs/17/functions-string.html)
