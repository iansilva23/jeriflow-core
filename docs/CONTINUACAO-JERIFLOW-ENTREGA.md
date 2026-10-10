# Continuação JeriFlow — integração incremental, 09/10/2026

## Base preservada
- Base escolhida: `feature/jeriflow-avisos-retencao-guarda-20261009` (`ba23c1e`), derivada da Ouvidoria ADM `3375159`.
- `main` **não foi modificada**; PRs #5, #6 e #7 mantidas sem merge.
- Esta branch não deve ser combinada diretamente com a PR #6: as migrações 011/012/013 têm definições alternativas e divergem.
- As migrações **013–016** desta branch pressupõem a migração 011 de retenção/avisos e a 012 da Guarda da branch #7. NÃO reaplicar IDs 011–013 da PR #6.
- Os dois fluxos de CI (contratos/PostgreSQL real e Chromium) devem estar verdes **no HEAD** antes de integração.

## Notificações internas
- Sem SMS, WhatsApp, e-mail ou push externos.
- Evento da Ouvidoria insere avisos em PostgreSQL na mesma transação; único por destinatário/evento/público.
- APIs e interfaces exibem contagem persistida de não lidas, total de notificações, histórico paginado e confirmação individual de leitura.
- Sem título, descrição, identificação do cidadão ou conteúdo sensível no corpo do aviso.
- Revogação do vínculo municipal retira acesso imediatamente.
- Cursor usa data de criação + ID e é vinculado ao próprio usuário e município.

## Retenção e LGPD
- Inventário por categoria/status, com números de protocolos, arquivados e protegidos, e contagem total de anexos.
- Rascunhos de prazo por categoria, incluindo denúncias, somente para avaliação: **não implicam aprovação legal**.
- Arquivamento lógico de protocolos encerrados e restauração; ambos auditados; histórico de alterações preservado.
- Nenhuma função de eliminação automática, física ou irreversível foi criada. `legal_hold` permanece ativo.
- `jeriflow_app` e scanner não recebem permissões diretas para alterar ou apagar tabelas de governança.
- Prazos legais, regras de descarte, cadeia de custódia e protocolos de litigância aguardam decisão institucional e parecer jurídico/DPO.

## Guarda/SEMUS: primeira fatia operacional
- App Guarda registra categoria, título, descrição, localização textual e horário UTC declarado no envio.
- Identificador UUID, idempotência do envio e bloqueio de alteração silenciosa no reenvio.
- Guarda acessa seus registros; `admin-semus` acessa os registros do próprio município.
- Painel SEMUS inicia análise e encerra atendimento com revisão otimista.
- Consulta protegida do histórico traz apenas ação, revisão e horário, sem identificar servidores no payload.
- Não há despacho oficial de equipes, GPS em tempo real, integração policial, recursos emergenciais ou instalação validada em dispositivos físicos.

## Critérios de saída e riscos
1. Conferir sucesso **no último commit** dos workflows `ouvidoria.yml` e `ouvidoria-browser.yml`, inspecionar logs e reparar qualquer falha.
2. Revisar diferenças e merge-base entre esta branch, #5, #6, #7 e `main`. Integrar com cuidado, uma trilha por vez, sem substituir migrações já executadas.
3. Homologar produção somente após VPS exclusivo JeriFlow (nunca VPS Ramo Nessa), CI/CD, HTTPS, isolamento de segredos, backups testados e restauração, alertas e observabilidade.
4. Comprovar operações ClamAV supervisionadas, atualização de assinaturas, retenção jurídica LGPD, controles de acesso, revogação e incidentes.
5. Homologar os quatro apps **instalados** em Android/iOS físicos; bundle não equivale a aplicativo publicado.
6. Fazer testes de carga, regressão, auditoria de segurança e aceitação institucional; não habilitar denúncias reais, emergências ou downloads de anexos em quarentena.
7. Manter readiness indisponível até comprovação real de infraestrutura e operação.

**Status:** desenvolvimento e testes em branch. Não é produção, não é homologação institucional, e não é merge autorizado da main.
