# JeriFlow — Anexos da Ouvidoria: armazenamento em quarentena

**Estado:** implementação em branch `feature/ouvidoria-anexos-quarentena-20261009`. Esta etapa **não aprova arquivos para leitura/download**, não habilita armazenamento público e não utiliza dados reais.

- Upload e lista de metadados protegidos via `POST /api/v1/ouvidoria/attachments/upload` e `POST /api/v1/ouvidoria/attachments/list`.
- Máximo **cinco arquivos por protocolo**, **1 MiB por arquivo**. JPEG, PNG ou PDF somente, base64 canônico e checagem preliminar de assinatura. O limite maior de corpo HTTP é exclusivo desta rota no servidor e no BFF; demais rotas mantêm 8 KiB.
- Vinculação ao protocolo e ao município, membro ativo Cidadão (protocolo próprio) ou Admin Cidadão/Ouvidoria (mesmo município). Protocolos fechados não aceitam novos arquivos.
- Conteúdo armazenado no PostgreSQL em `bytea` cifrado com AES-256-GCM, chave derivada via HKDF da chave de identidade existente, nonce aleatório e AAD ligado a município, protocolo e ID da tentativa. Nenhum conteúdo aparece na resposta HTTP ou na listagem.
- Identificador de solicitação obrigatório; mesmo arquivo/mesma tentativa não é duplicado. Metadados são retornados sem chave/bytes/hash. Acesso direto à tabela é revogado do papel da API.
- Quarentena **fail-closed**: arquivo entra com status `quarantined`; não existe operação HTTP para retornar bytes ou marcar `clean`. Não aceitar arquivo como seguro pela extensão/MIME/simples assinatura.
- Interface inicial do painel administrativo permite selecionar e enviar arquivo, com status visível. App Cidadão recebe a API autenticada; selecionar arquivo nativamente ainda depende de picker e revisão de privacidade/permissões.
- O escaneamento antimalware assíncrono, fila/worker, política de retenção e trilha de acesso serão implementados antes da liberação segura de downloads. Não divulgar que imagens e documentos estão prontos para consulta.
