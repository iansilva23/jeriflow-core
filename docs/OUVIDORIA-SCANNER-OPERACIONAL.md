# JeriFlow — scanner da Ouvidoria com acesso mínimo e atualização contínua

**Estado:** preparado e testado em branch isolada. NÃO instalado em VPS e NÃO habilita leitura pública. A migração `009-ouvidoria-scanner-role.sql` cria o papel `jeriflow_scanner` com **NOLOGIN**, sem acesso direto a tabelas. Somente as funções `app.ouvidoria_scan_claim` e `app.ouvidoria_scan_finish` têm EXECUTE concedido. Ambas atuam como funções `SECURITY DEFINER` com regras de leasing, 3 tentativas máximas e auditoria.

## Credenciais de produção ou homologação futura

Um administrador deve criar, no banco **dedicado ao JeriFlow**, um usuário de login distinto do owner e do usuário API, concedendo-lhe apenas participação no papel `jeriflow_scanner`. A senha fica em arquivo protegido (0600) acessível apenas ao UID do scanner; **nunca** no GitHub. O worker recusa login proprietário, privilégio direto de SELECT/UPDATE/INSERT nas tabelas e falta de autorização às funções.

`scripts/ouvidoria-scanner-service.mjs` exige habilitação explícita `JERIFLOW_SCANNER_ENABLE=1`, variáveis de host/porta/nome do banco, usuário dedicado, caminho do arquivo de senha, socket Unix do clamd, diretório com assinaturas oficiais e chave da identidade armazenada conforme `readIdentityKey` (pasta 0700, arquivo 0600 e UID correto). O modo `--once` executa um único ciclo; sem ele, o serviço repete a cada 15 segundos e só retira item se `daily`, `main`, `bytecode` estiverem presentes e `daily` tiver até 72 horas. Não expõe clamd por TCP.

**O FreshClam precisa estar configurado como serviço do sistema com atualizações recorrentes**, incluindo atualização da base `daily` e manutenção de `main`/`bytecode`, logs de erros e alertas por assinaturas expiradas. A verificação é fail-closed; assinatura expirada ou indisponível bloqueia novos scans sem mudar `quarantined` para `clean`. Isso não é substituto de supervisionar `clamd`, reiniciar o worker, monitorar disco, fila atrasada, relatórios e restaurar backup.

### Bloqueios de produção

- Identidade institucional, sigilo de denúncias, retenção/eliminação LGPD e testes de permissões reais.
- VPS EXCLUSIVO do JeriFlow, segredos e conta operacional configurados pelo titular; backup/restauração e monitoramento.
- Testes de worker permanente, rotação de chave/credenciais, ClamAV atualizando continuamente e Android/iOS instalados.
- Leitura/download segue **bloqueada em produção**; somente testes locais no endpoint `read-test`.

**Não reutilizar o VPS nem segredos do Ramo Nessa.** O processo do JeriFlow só poderá ser ativado após provisionamento explícito do ambiente próprio.
