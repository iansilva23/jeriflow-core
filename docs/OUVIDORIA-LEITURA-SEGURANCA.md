# Ouvidoria — endurecimento da leitura local de anexos

Esta etapa conserva o recurso de leitura APENAS para homologação local, sem botões de download na interface.

## Regras automáticas

- A API somente permite a rota `read-test` quando `NODE_ENV=test` **e** `JERIFLOW_ATTACHMENT_READ_TEST_ONLY=1`. Para `production`, `development`, ausência de flag ou outras configurações, responde 503. Não ativar nenhuma dessas variáveis no VPS.
- O BFF do painel administrativo mantém `/ouvidoria/attachments/read-test` fora da allowlist. O navegador recebe 404, mesmo autenticado.
- A SQL exige o status `clean` **e o último evento antivírus `clean`** antes de qualquer leitura.
- Conteúdo criptografado alterado deve falhar na autenticação AES-GCM, com HTTP 503 e sem payload Base64. Nenhum conteúdo armazenado deve ser apresentado em resposta de erro.
- Testes reais com PostgreSQL verificam bloqueio em quarentena, isolamento municipal, trilha de acesso e restauração da fixture adulterada.
- Testes não substituem antivírus operacional, proteção de denunciantes, política de retenção, análise jurídica/LGPD nem testes Android/iOS físicos.

O desbloqueio em produção permanece **proibido** até as políticas de sigilo, retenção e papéis serem aprovadas e houver implantação isolada com scanner supervisionado.
