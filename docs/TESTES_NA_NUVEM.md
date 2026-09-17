# Execução preparada no GitHub — Etapa 2 aberta

Atualização: 17/09/2026. Não houve execução remota nem contratação de VPS.
A conexão de conta, a instalação do conector e o acesso de escrita ao repositório
privado iansilva23/jeriflow-core foram confirmados. O acesso a Actions e o
resultado da primeira execução ainda precisam ser comprovados.

## Rotina preparada

O arquivo .github/workflows/check.yml define uma execução iniciada manualmente,
em uma máquina Ubuntu 24.04 temporária. Nenhum push ou pull request a inicia.
Uma execução tem limite de 20 minutos; execuções da mesma referência não se
sobrepõem. Isso limita consumo, mas não é um limite financeiro da conta.

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

## Sequência para o assistente

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

Ela não compila APK/AAB/IPA, não inicia simulador iOS, não faz testes em celulares
nem publica nas lojas. A compilação nativa dos quatro apps exige uma rotina
adicional Android/macOS, que continua pendente. O relatório mantém stage2Closed
como false. A infraestrutura de testes é temporária; não é hospedagem do produto.

O arquivo docs/VERIFICATION.json incluído neste ZIP permanece sendo a evidência
da execução LOCAL de 16/09/2026. Não foi trocado por uma simulação de resultado
do GitHub. A nova configuração YAML precisa da primeira execução remota para
comprovar o comportamento da plataforma.

## Referências

- [Execução manual](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [Máquinas hospedadas](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)
- [Artefatos e retenção](https://docs.github.com/en/actions/tutorials/store-and-share-data)
