# JeriFlow — Operações de desenvolvimento: notificações, retenção e Guarda

Esta entrega é incremental. **Não significa que os quatro blocos estão homologados em produção.** A branch parte do ADM da Ouvidoria aprovado e preserva o Bloco 4.

## Notificações internas da Ouvidoria

A migração 011 registra automaticamente eventos de abertura, início de análise, resposta, contestação e encerramento para o cidadão autor, além de avisar usuários com perfil administrativo ativo sobre a abertura de protocolos. Os registros contêm somente código de evento, protocolo, destinatário, município, data e leitura. **Não copiam descrição, identidade, foto, texto de denúncia ou anexo.** O acesso aos avisos exige sessão pronta e vínculo municipal ativo. A leitura por API marca somente o próprio aviso; histórico preservado. Interface in-app do Cidadão e painel do ADM apresentam avisos com atualização manual.

**Pendentes:** push, email/SMS, cadências, retentativas de entrega externa, preferências do usuário e opt-out quando aplicável. Nenhuma mensagem externa é enviada por esta branch.

## Retenção e LGPD

A migração 012 prepara uma política por município, com prazo configurável de 30 a 3650 dias **somente após aprovação expressa**, desabilitada por padrão. Todo protocolo recebe `legal_hold=true` inicialmente. A consulta administrativa de previsão confirma quantidade de itens potencialmente elegíveis; não altera nem remove registros. **Não existe job de deleção automática nesta etapa**, nem prazo legal fixado unilateralmente. Exigir aprovação institucional, classificação de dados e política documentada, mecanismo verificável de exclusão ou anonimização, prova de restauração e revisão jurídica antes de executar descarte.

## App Guarda e painel SEMUS

A migração 013 cria ocorrências vinculadas ao município com quatro categorias, localização de referência textual, relato resumido, controle de revisões e estados `open → in_progress → resolved`. O perfil `guarda` ativo pode registrar e atualizar; perfis `guarda` e `admin-semus` podem consultar no seu município. Operações geram trilha de auditoria imutável e idempotência por requisição. A interface nativa de Guarda registra e consulta essas ocorrências; o painel SEMUS tem visão inicial de leitura protegida por autorização no servidor.

**Pendentes para módulo Guarda completo:** equipes, despacho, acompanhamento geográfico, anexos específicos, fluxos de patrulha, notificações entre operadores, geolocalização consentida, aprovações e regulamentação operacional. Não usar dados reais.

## Validação e isolamento

O pipeline preserva 92 testes unitários anteriores e os 52 cenários de identidade e executa integração PostgreSQL com notificações/retencão/Guarda adicionados à regressão da Ouvidoria. O Chromium verifica que o painel existente segue funcional. Não há implantação, migração ou alteração na `main`; nenhuma alteração no VPS do Ramo Nessa.
