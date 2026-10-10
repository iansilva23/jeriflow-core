# JeriFlow V5.16 — Fase 14: FreshClam oficial e clamd carregado no MESMO runner

**Regra suprema respeitada:** ZIP `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`, conteúdo ZIP validado com `unzip -t` ANTES de editar. Fontes originais inspecionadas: `cidadao-ai/index.html` `#trafficForm`/`submitTrafficForm`, `shared/jeriflow-audit-citizen.js` `evidence()` e `submitTrafficForm()`. Mantidas sete categorias, nome/nascimento/telefone para visitante, foto obrigatória, local, descrição, placa opcional, estado `RECEBIDA` e protocolo compartilhado por Guarda/SEMUS.

## Etapa isolada, sem alterar nenhuma função de produto

- `tests/integration/clamav-official-daemon-together-v516.test.mjs` roda com FreshClam executado ANTES, no MESMO runner, verificando bases `main`, `daily` e `bytecode` com assinatura oficial válida e daily recente.
- Inicia **clamd verdadeiro** com `DatabaseDirectory` explícito, lendo uma cópia das MESMAS bases assinadas do FreshClam, numa área temporária privada. Confere que a versão daily informada pelo comando `VERSION` corresponde à obtida via `sigtool --info` após verificação criptográfica.
- Envia assinatura EICAR de teste **inofensiva** ao daemon pela interface `INSTREAM`, esperando detecção pelas bases oficiais. Duas fotos WebP completamente sintéticas: uma permanece limpa; outra passa a ser detectada depois de inserir **uma assinatura local de teste** e executar `RELOAD` no mesmo daemon. Revalida `VERSION` e as três assinaturas oficiais após recarga.
- Em toda a etapa, `evidenceApproved` e `protocolCreated` continuam `false`. Nenhuma fotografia é vinculada a dados de usuário, não há UI nova, protocolo duplicado ou publicação de URL.
- O runner não abre portas TCP. O scanner escuta APENAS Unix socket privado. Sem dados reais, credenciais secretas, servidor VPS, produção, Ramo Nessa ou sistema financeiro.

## Política de Downloads e limitações

**Uma única tentativa FreshClam no workflow; sem downloads diretos.** Após a evidência positiva no GitHub Actions, limitar o workflow pesado a `workflow_dispatch` (acionamento manual), preservando apenas testes offline recorrentes. A CDN pode limitar runners compartilhados; nunca fazer retries automáticos repetidos ou baixar CVDs via HTTP direto.

**Não equivale a homologação em VPS** nem estabelece serviço persistente, atualização agendada, métricas ou reinício de clamd. `VERSION` prova apenas a versão diária declarada e não é atestado integral de `main/bytecode`; por isso este teste combina verificação criptográfica dos arquivos, `DatabaseDirectory` da configuração do daemon, detecção EICAR e recarga observada em WebP. Ainda não substitui testes de operação duradoura, políticas de retenção LGPD ou integração dos aplicativos.

## Próximos bloqueios

1. Instalar isoladamente serviços de scanner/atualizador, provisionar credenciais do worker e medir atualização/recarga no ambiente de homologação JeriFlow (apenas mediante autorização específica).
2. Receber foto do Cidadão em rota HTTP protegida, sem confiar em `deviceId`, `registered` ou status antimalware informados pelo aplicativo.
3. Consumir a foto elegível e emitir um único protocolo canônico, com autorização da Guarda/SEMUS, controles LGPD e homologação física.
4. Não fazer merge enquanto a sequência de PRs em DRAFT não for revisada como conjunto.

**Base exata:** PR #28 commit `ba6c17028617541a8eed61263ee2bfd4c4594f05`. Esta PR é empilhada, DRAFT, e a branch `main` não é modificada.

Docs de protocolo e configuração oficiais: https://docs.clamav.net/manual/Usage/ClamdProtocol.html, https://docs.clamav.net/manual/Usage/SignatureManagement.html.

## Evidência efetivamente executada em 10/10/2026

- [GitHub Actions 38065052328](https://github.com/iansilva23/jeriflow-core/actions/runs/38065052328), commit `499d2ed103fe642638cb9d1b72c211bdddb758e2`, `completed/success`.
- FreshClam oficial executou, o script `check-official-clamav-v516.mjs` confirmou `ready: true` e `dailyWithin72Hours: true` para as três bases válidas.
- **10/10 testes** do daemon real no mesmo runner com bases oficiais passaram, incluindo assinatura EICAR inofensiva, WebP sintético e recarga real por assinatura .hdb. **14/14** testes de regressão passaram; TypeScript sem falha.
- O commit posterior muda apenas a política de workflow: o teste completo que baixa CVDs passa a ser executado **somente por `workflow_dispatch`** para respeitar os limites da CDN. A verificação rápida é automática nos pushes e não baixa assinaturas.
- Esta evidência não inclui a execução contínua no VPS, seus backups, logs, monitoração, atualização automática, credenciais segregadas em homologação ou envio de fotografias reais por aplicativo.
