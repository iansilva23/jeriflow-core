# Situação atual — Etapa 2 concluída; início do backend

O código verificado está neste pacote. A continuação escolhida usa o GitHub;
não é necessário configurar o Mac para começar os testes da base e dos bancos.

Em 17/09/2026, o responsável criou o repositório privado e instalou o conector
com acesso ao projeto. A integração confirmou a conta iansilva23, a visibilidade
privada e a permissão de escrita em
[iansilva23/jeriflow-core](https://github.com/iansilva23/jeriflow-core).

A criação do repositório, a liberação de acesso, o envio da base e uma execução
completa dos testes em nuvem estão concluídos. Foi corrigido um erro real na
preparação da senha do PostgreSQL. PostgreSQL e Redis passaram em conexão e
operações com dados fictícios. Veja o histórico e as evidências em
[docs/TESTES_NA_NUVEM.md](docs/TESTES_NA_NUVEM.md).

Os quatro apps iOS já foram compilados, instalados e abertos duas vezes cada
em iPhone Simulator. Os quatro Android também compilaram, foram instalados e
abriram duas vezes na execução 35373594989. Cidadão passou após repetir o teste;
a primeira tentativa teve travamento de System UI no emulador. A validação
nativa passou, mas a estabilidade desse ambiente ainda tem uma ressalva aberta.
Relatórios, capturas e a falha original estão em
[docs/VALIDACAO_NATIVA.md](docs/VALIDACAO_NATIVA.md).
Em 19/09/2026, a preparação corrigida foi conferida nas execuções 35379274017
e 35380520136: oito aberturas Android, com estabilidade observada e sem
reinicialização nos testes aprovados. Etapa 2 concluída no escopo técnico.
Agora começa o núcleo de identidade do backend; não liberar produção nem declarar o produto pronto.
Os critérios completos estão em docs/ETAPA_2.md.

Os workflows mantêm início manual. Enviar o código não inicia os testes. A franquia
e o bloqueio de gastos extras foram conferidos antes do primeiro disparo e não
foram alterados. Não foi contratada VPS nem hospedagem permanente.

## Alternativa local — diagnóstico do Mac

Use esta alternativa apenas se decidirmos testar no seu computador.

1. No Mac, descompacte o ZIP e abra a pasta jeriflow-etapa2.
2. Dê dois cliques em VERIFICAR_MAC.command.
3. Envie o arquivo cujo nome começa com JERIFLOW_DIAGNOSTICO_MAC, criado nessa pasta.

Esse diagnóstico não exige Node ou Python previamente instalados, não pede senhas,
não instala programas e não altera configurações. Lê macOS, processador, memória
e a disponibilidade de ferramentas. O único arquivo que cria é o relatório.
Ele não inclui número de série, arquivos pessoais, credenciais ou contas.

Se não abrir ou mostrar erro, envie a mensagem exibida. Não é preciso tentar
comandos alternativos nem instalar vários programas por conta própria.

Com o resultado, o assistente indicará o próximo passo compatível com o seu Mac.
Encontrar os programas não significa que a compilação ou o banco foram aprovados;
essas verificações vêm em seguida. Nenhuma conta, assinatura ou contratação é necessária
para gerar este diagnóstico.
