# FreshClam — teste oficial isolado

Este trabalho é separado da homologação aprovada com ClamAV real e assinatura EICAR local. Testa baixar o arquivo **daily.cvd ou daily.cld diretamente com o FreshClam** e inspecionar metadados oficiais pelo sigtool. O teste reprova bases diárias com mais de 72 horas ou arquivos ausentes/corrompidos, e salva somente um relatório sem assinaturas, sem emails, sem fotos.

Limitações: base `daily` apenas, não basta para cobrir todas as definições oficiais; FreshClam pode bloquear IPs compartilhados de runners por limites de download; nenhuma implantação de serviço permanente com atualização recorrente foi realizada. Não desbloquear downloads da Ouvidoria com base nesse ensaio. Para produção, exigir também bases principais/bytecode, política de atualização contínua, evidência de assinatura autêntica, usuário restrito, monitoramento e revisão LGPD.

## Ampliação para bases oficiais completas

O workflow nesta branch baixa as bases `main`, `daily` e `bytecode` pelo FreshClam; exige que todas existam e que `daily` tenha até 72 horas. Em seguida inicia `clamd` verdadeiro, usando essas bases oficiais e **sem assinatura local injetada**; verifica arquivo benigno e EICAR. Relatório de versão/detecção é arquivado sem os bancos ou bytes do teste. Essa prova continua em runner isolado, sem implantação em VPS, sem garantias de detecção universal e sem liberar download na Ouvidoria.
