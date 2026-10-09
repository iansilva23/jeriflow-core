# FreshClam — teste oficial isolado

Este trabalho é separado da homologação aprovada com ClamAV real e assinatura EICAR local. Testa baixar o arquivo **daily.cvd ou daily.cld diretamente com o FreshClam** e inspecionar metadados oficiais pelo sigtool. O teste reprova bases diárias com mais de 72 horas ou arquivos ausentes/corrompidos, e salva somente um relatório sem assinaturas, sem emails, sem fotos.

Limitações: base `daily` apenas, não basta para cobrir todas as definições oficiais; FreshClam pode bloquear IPs compartilhados de runners por limites de download; nenhuma implantação de serviço permanente com atualização recorrente foi realizada. Não desbloquear downloads da Ouvidoria com base nesse ensaio. Para produção, exigir também bases principais/bytecode, política de atualização contínua, evidência de assinatura autêntica, usuário restrito, monitoramento e revisão LGPD.
