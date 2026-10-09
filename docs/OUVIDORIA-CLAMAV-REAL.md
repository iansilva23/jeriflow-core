# Homologação de laboratório: ClamAV real da Ouvidoria

Execute `scripts/homologation/clamav-real.mjs` somente no ambiente local isolado. A suíte inicia o **processo clamd verdadeiro**, com socket Unix e base de assinatura NDB **gerada exclusivamente para o ensaio EICAR**. Exercita a função cliente do JeriFlow: ping + INSTREAM; arquivo limpo, EICAR, conteúdo contaminado e daemon indisponível.

Essa etapa prova compatibilidade do cliente com o processo real. **NÃO comprova frescor de assinaturas oficiais, nem defesa contra malware em produção.** O relatório registra explicitamente `officialSignaturesFresh:false` e `productionApproved:false`. Antes de implantação são obrigatórios: base oficial autenticada e atualizada por FreshClam, atualização monitorada, ClamAV isolado/usuário mínimo, varredura fim a fim contra PostgreSQL, teste de restauração/retensão, inspeção de arquivos e monitoramento; executar em VPS dedicado ao JeriFlow.

Não criar endpoint de download enquanto faltar essa homologação e aprovação de sigilo. O teste usa uma assinatura local controlada e não inclui amostras executáveis de malware.

Referências: documentação oficial do protocolo ClamD https://docs.clamav.net/manual/Usage/ClamdProtocol.html e assinaturas NDB https://docs.clamav.net/manual/Signatures/ExtendedSignatures.html.
