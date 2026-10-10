# JeriFlow V5.16 — Fase 18: formulário de Trânsito completo e confirmação segura do protocolo

**Regra suprema observada antes de editar:** ZIP original `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`; SHA256 **`89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`**; integridade `unzip -t` confirmada. Fontes originais: `cidadao-ai/index.html` `#trafficForm`, `#trafficType`, `#trafficLocation`, `#trafficPlate`, `#trafficDescription`, câmera/galeria, `submitTrafficForm()`; `shared/jeriflow-audit-citizen.js` `formIdentity()`, `evidence()`, `submitTrafficForm()`. Guarda `guarda-semus/index.html` e `admin-semus/index.html` compartilham os mesmos protocolos de trânsito, sem outra ocorrência.

## O que foi implementado

- `apps/api/src/traffic-form-submit-v516.ts`: serviço **privado** `TrafficRegisteredFormServiceV516`, sem endpoint, recebe os únicos campos aprovados: **sete títulos originais**, local, placa opcional de até oito caracteres, descrição e fotografia obrigatória. Normaliza espaços/placa em maiúsculo, valida sessão e moderação/município **antes** de armazenar. Não aceita `registered`, `citizenId`, data de nascimento, `photoId` ou status de evidência declarados pelo navegador; identidade do cadastro vem do PostgreSQL.
- Chama `TrafficPhotoPrivatePipelineV516.receiveRegistered()`, que efetua quarentena, limpeza EXIF, store privado, reserva de titularidade, scanner e gate SQL. O recibo privado alimenta **exclusivamente** `app.citizen_v516_traffic_submit()`, função canônica da migração 005 com o trigger de proprietário 007 e role `jeriflow_app`. **Um protocolo `JF-AAAAMMDD-NNNNNN`**, status original `RECEBIDA`, categoria `Trânsito (SEMUS)`, destino `SEMUS / Guarda de trânsito`.
- `infra/migrations/008-citizen-v516-traffic-confirm-ack.sql`: função de confirmação **apenas de leitura**, SECURITY DEFINER, sem conceder SELECT de tabelas à API. Após falha de rede/ACK do `traffic_submit`, o servidor **não repete INSERT**: só pode confirmar um protocolo já consumido pela **mesma conta e sessão ativas**, município, UUID e SHA da fotografia. Conta de outro município/outro cidadão, SHA diferente ou sessão revogada retornam NULL. Não altera a função original e não inventa identificador de protocolo.
- `tests/traffic-form-submit-v516.test.mjs`: todas as sete categorias, validação de campos, ausência de sessão, conta bloqueada, falha antes da escrita em disco.
- Teste integrado já existente da etapa 17 estendido: `tests/integration/traffic-photo-private-pipeline-real-v516.test.mjs` aplica migrations 001–008 e testa **formulário completo** com credenciais PostgreSQL segregadas, imagens reais sintéticas, scanner `clamd` verdadeiro com assinatura HDB local inofensiva, destino/status e proprietário correto, confirmação de ACK, rejeição de outro proprietário, token revogado e assinatura falsa. O teste **não** usa assinaturas oficiais em cada push: prova de instalação/verificação das bases oficiais em runner isolado da PR #29.

## Restrição absoluta de funcionalidade e implantação

Este commit **NÃO altera HTML ou design do aplicativo**, não instala recursos no VPS e não habilita rotas. `main.ts` continua sem dependências `trafficPhoto`: rota da etapa 15 ainda responde **503 `NOT_IMPLEMENTED`**. Esta camada é chamada somente pelo código de confiança e pelos testes em runner descartável. Os aplicativos RN não foram conectados ao serviço.

**Visitante** é permitido pela V5.16 na UI, mas o `deviceId` gerado/localmente não prova titularidade; a operação cadastrada não deve ser confundida com a etapa de visitante. Não retirar a opção da UI e não falsificar autenticação do visitante.

## Recuperação e pendências de segurança

- Falha do SQL depois do scanner pode deixar **reserva, foto ou gate não consumidos** no armazenamento privado. A consulta 008 recupera apenas uma confirmação já gravada; se a consulta falhar/retornar NULL, o serviço emite `TRAFFIC_SUBMISSION_UNCERTAIN`, **não** afirma que foi enviado e **não** refaz upload/protocolo automaticamente.
- Ainda faltam mecanismo durável de *tentativa idempotente* para resposta após queda do processo, reconciliação/limpeza transacional da mídia órfã, quotas e limites distribuídos, retenção LGPD, logs de auditoria sem PII, rate-limit e prova de visitante.
- Falta integrar realmente câmera/galeria + campos ao mesmo pedido autenticado na API e apps RN, além de homologar Guarda/SEMUS ponta a ponta em dispositivo e scanner persistente com bases oficiais no VPS.
- Segurança operacional: a chamada ao SQL usa papel `jeriflow_app`, a varredura usa credencial restrita separada, o frontend jamais envia ou recebe ticket privado e nenhuma função de scanner é exposta no HTTP público.

**Base PR #32:** HEAD `48f2f9dba87c033b337088541b7eaddcbc67d188`. Nova PR DRAFT empilhada, sem merge ou mudança na `main`. Nenhum deploy, VPS ou Ramo Nessa.
