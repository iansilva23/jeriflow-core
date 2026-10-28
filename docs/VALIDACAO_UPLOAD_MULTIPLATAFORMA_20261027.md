# Rejeição de upload — diagnóstico e validação de teste

Base: PR100 HEAD `cbedd08e287797c0b659c36bf1de48def182646e`, com código de dependências já aprovado no CI40566863216. Alteração exclusivamente em teste, sem app/API, limite de8MiB, autenticação, scanner, armazenamento, SQL ou workflow modificados.

## Causa observada

O teste antigo enviava um Buffer de8MiB+1 com Content-Length e aguardava o JSON pelo fetch. A API recusa esse tamanho pelo cabeçalho antes de consumir o corpo e encerra a conexão. No macOS/Node24.22.1, a escrita do corpo pode receber ECONNRESET e ocultar a resposta HTTP. A mesma suíte passava no Linux/Node24.19.0. A comparação local com clienteHTTP direto observou413/TRAFFIC_PHOTO_TOO_LARGE e zero chamadas ao pipeline, embora uma tentativa com envio integral concorrente também tenha reproduzido erro de escrita. Não se trata de uma garantia de comportamento de todos os clientes.

O envio chunked com8MiB+1 retornou413 e não chamou o pipeline. Não foi comprovado defeito do handler, portanto **nenhuma implementação de produto foi alterada**.

## Verificações corrigidas e ampliadas

1. Content-Length de8MiB+1: enviar somente cabeçalhos, exigir resposta HTTP413, JSON TRAFFIC_PHOTO_TOO_LARGE e nenhuma chamada ao pipeline. Demonstra a barreira anterior ao corpo.
2. Transfer-Encoding chunked: enviar os8MiB+1 reais, sem Content-Length, exigir o mesmo status/erro e nenhuma chamada ao pipeline. Demonstra o limite do contador de bytes, independentemente do tamanho declarado.

O cliente do teste limita o JSON de rejeição a4KiB e a espera a5s, trata erros de requisição/resposta e encerra o pedido após ler o JSON completo. **ECONNRESET nunca é aceito como PASS.** A verificação antiga de413 e ausência de armazenamento permanece, agora com exigência adicional do código de erro e cobertura de upload sem tamanho declarado.

## Resultado local e limites

- Teste de foto/HTTP:12 PASS/0 FAIL/0 SKIP.
- Tipagem do projeto e workspaces:PASS.
- Suíte completa no macOS/Node24.22.1:330 PASS/0 FAIL/0 SKIP.
- CI Linux do novo teste: pendente ao preparar este commit; preservar resultado antes de fechar a ressalvaQ05.

Os erros anteriores não foram apagados: constam dos checkpoints/PR100 e dos relatórios de revisão de dependências. Esta alteração não homologa upload operacional público, navegador real ou aparelho físico. A rota continua desligada no main.ts; a integração completa de anexos permanece parcial emC04/F02/F03. Revisão independente permitida enquanto F00 aguarda os originaisV5.16/arquitetura.

## Fechamento do escopo do teste

[Execução40614992068](https://github.com/iansilva23/jeriflow-core/actions/runs/40614992068), código `8391d14075bf87694d5be51a77aa2e2401fb201d`, **SUCCESS** no Linux/Node24.19.0:330/330 testes da suíte completa aprovados, além de tipagem e contrato de apoio da Guarda. `ci-summary.json` registra a contagem original extraída dos logs; logs completos não publicados.

O mesmo conjunto passou no macOS/Node24.22.1 (330/330). A diferença do teste foi resolvida no escopo desta PR, sem aceitar ECONNRESET, alterar produto/limite ou repetir compilação/banco sem mudança. Q05 como domínio geral permanece parcial; os fluxos municipais, apps físicos e anexos operacionais não estão aprovados por este teste. PR101 DRAFT empilhada na PR100, sem merge.
