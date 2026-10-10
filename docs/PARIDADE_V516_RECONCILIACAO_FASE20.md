# JeriFlow V5.16 — Fase 20: reconciliação conservadora das fotografias

## Fonte suprema verificada ANTES de editar

ZIP `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, `unzip -t` sem falhas. Reabertos `cidadao-ai/index.html` (`#trafficForm`, `submitTrafficForm`) e `shared/jeriflow-audit-citizen.js` (`evidence`, `submitTrafficForm`). Os fluxos de cidadão cadastrado, visitante, SEMUS/Guarda, foto obrigatória, sete tipos e status do protocolo original NÃO mudaram.

## Risco que impede apagar automaticamente

Arquivo WebP e PostgreSQL NÃO participam de uma mesma transação. Se a remoção ocorrer antes do COMMIT do banco, o protocolo pode guardar um ID cujo arquivo desapareceu. Se apagar a linha primeiro, pode sobreviver mídia sem referência. Um preview SQL não equivale a bloqueio transacional: um protocolo novo pode aparecer depois que o SQL selecionou o candidato. **Jamais usar o resultado desta etapa como lista de remoção.**

## Entrega técnica

- **Migração 010:** cria papel `jeriflow_v516_reconciler` NOLOGIN, sem permissões para leitura direta de tabelas ou acesso pela role HTTP/scanner. `app.citizen_v516_traffic_reconcile_preview(municipality_id,older_than_hours,limit)` é uma função SECURITY DEFINER **somente SELECT**, sem DELETE/UPDATE. Exige idade mínima de 72 h, no máximo 100 resultados por chamada e um município explícito.
- Proteções de elegibilidade: proíbe fotos já ligadas a protocolo; qualquer foto referenciada numa tentativa (inclusive `PHOTO_READY` e `COMPLETE`); fotos recentes; hashes e município incoerentes; mídia com `consumed_by` preenchido; **qualquer tentativa recente ainda em andamento da mesma conta**, inclusive no intervalo entre armazenamento e vinculação de foto.
- **`TrafficPhotoReconcilerV516`** só funciona num serviço interno com credenciais dedicadas; consulta candidatos em PostgreSQL, lê WebP e manifesto do armazenamento privado via `O_NOFOLLOW` (código pré-existente `TrafficCleanPhotoStoreV516.readPrivate`), confere SHA-256 completo e retorna **somente contagens**. Sinaliza como suspeitos os arquivos ausentes, inconsistentes ou links simbólicos. Nenhum UUID, SHA, PII ou caminho é devolvido ao cliente.
- **Destruição: ZERO.** Retorno `mode:READ_ONLY`, `deletedFiles:0`, `deletedDatabaseRows:0`. Esta PR deliberadamente não chama `unlink`, `DELETE` ou a rotina `discardUnlinked`. Também não cria endpoint público, cron ou botão no HTML.
- **Testes PostgreSQL 17/FS reais** em runner descartável com dados exclusivamente sintéticos: registros protegidos de protocolo, foto com scanner, foto sem scanner, foto recente, outra prefeitura, falta de manifesto, link simbólico, tentativa ativa, `PHOTO_READY`, permissões e ausência de efeitos colaterais.

## Bloqueios antes de implementar exclusão

1. Implementar uma **reserva transacional de limpeza/tombstone (fencing)** com exclusão mútua efetiva frente a `traffic_submit`, `traffic_attempt_photo_ready` e worker de scan. Sem isso, nem uma foto de 72 horas deve ser apagada automaticamente.
2. Aplicar protocolo de duas fases: marcar e isolar mídia, confirmar no PostgreSQL que não há protocolo/tentativa válida e fazer limpeza física idempotente com retentativa após falha parcial. Definir estratégia de restauração caso o arquivo falhe na remoção. Só então liberar exclusão no serviço interno.
3. Rever quotas, retenção LGPD, reconciliação de arquivos sem manifesto e segurança de symlink/hardlink; fazer homologação com scanner oficial no mesmo ambiente. Auditar vulnerabilidades npm e regressões concorrentes.
4. **Não habilitar a API ou visitante sem a prova de posse válida.** Rota da PR #30 continua desativada em `main.ts` e as telas V5.16 permanecem intactas.

**Base da branch:** PR #34 HEAD `3c8fc61aa411354c25dd2942c501cc085df885c5`; PR empilhada DRAFT, sem merge, VPS, produção ou Ramo Nessa.
