# JeriFlow – worker antivírus da Ouvidoria (ambiente isolado)

O armazenamento cifrado e a quarentena dos anexos já são a base aprovada. A migração 007 adiciona leasing e contagem de tentativas de varredura, e uma tabela exclusiva de eventos de scan.

**Implementado nesta etapa:** worker de execução única `scripts/ouvidoria-scan-once.mjs`, comunicação direta ao **socket Unix local** de `clamd` por `zINSTREAM\0`, `PING`, controle de resposta, timeout, limitação de bytes, autenticação do conteúdo cifrado com AES-GCM, confirmação de tamanho e SHA-256, transição atômica de estado por UUID de lease, e journal próprio de resultado. Só `stream: OK` promove a `clean`; `FOUND` produz `rejected`. Falha, timeout, erro de arquivo, antivírus indisponível e resposta inconclusiva mantêm `quarantined`, com no máximo 3 tentativas.

**Cuidado:** a API não pode escrever na tabela de scan, e **não existe rota para devolver os bytes** — nem mesmo após `clean`. Isso exige uma etapa adicional de autorização, logs de leitura, antivírus real com definições atualizadas, validação de formatos mais profunda e regras de sigilo/LGPD.

A execução local só é permitida quando `NODE_ENV` não é production e `JERIFLOW_SCAN_LOCAL_ONLY=1`. Exemplo em ambiente de testes com `clamd` rodando em socket Unix:

```sh
JERIFLOW_SCAN_LOCAL_ONLY=1 JERIFLOW_CLAMD_SOCKET=/run/clamav/clamd.ctl node scripts/ouvidoria-scan-once.mjs
```

O worker local usa o cliente proprietário de desenvolvimento, que **NÃO deve ser reutilizado em produção**. Em produção deverá existir um usuário limitado, gestão de segredos, atualização/monitoramento de assinaturas ClamAV e isolamento do daemon. Clamd não fala TLS/autenticação por TCP; não expor sua porta ao público. O worker nunca lê do app Cidadão ou painel sem passar pela API para o upload.

**Validação nesta branch:** testes de protocolo ClamAV simulando respostas clean/infected/error, criptografia, lease e falha segura; testes PostgreSQL com scanner injetado exclusivamente no CI, não um ClamAV real. Só declarar antivírus real homologado quando houver execução e assinatura real verificadas por ClamAV, com casos EICAR de laboratório e assinatura atualizada. Testes de browser continuam verificando quarentena e ausência de download. Ainda faltam testes em VPS e aparelhos físicos.

Fonte técnica: ClamAV clamd INSTREAM: https://docs.clamav.net/manual/Usage/ClamdProtocol.html
