# JeriFlow V5.16 — Fase 7: fronteira de identificação da denúncia de trânsito

**Fonte reaberta e ZIP verificado antes das alterações:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip` (SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`).

## Correspondência exata, sem alterar UX

| HTML/JavaScript original | Comportamento | Implementação interna |
|---|---|---|
| `cidadao-ai/index.html` ~1261 `currentCitizen()` | Conta cadastrada mantém identidade da sessão do Cidadão | `resolveTrafficCitizenIdentityV516` obtém dados de resolvedor de sessão autenticada, **não** da identidade enviada pelo cliente |
| `cidadao-ai/index.html` ~1335 `readFormIdentity("trafficGuest")` | Visitante sem conta informa **nome, nascimento, telefone** | Exatamente esses três campos obrigatórios; `registered:false`, `citizenId:""`, `address:""`, `login:""` |
| `shared/jeriflow-audit-citizen.js` `formIdentity(prefix)` | Prioriza a identidade vinculada a `currentCitizen()` quando cadastrada | Com sessão válida, ignora completamente campos de visitante que tentem substituir a conta |
| `cidadao-ai/index.html` `citizenModerationState()`/`citizenSubmissionAllowed()` | Conta cadastrada bloqueada administrativamente não envia nova solicitação; visitante identificado pode apresentar denúncia | A conta verificada precisa ser ativa, do município informado e sem bloqueio; visitantes não ganharam nova regra de bloqueio |
| `cidadao-ai/index.html` `submitTrafficForm()` | Depois da identificação, denúncia exige os mesmos sete tipos, local, descrição e foto; cria o mesmo protocolo | Não modifica os contratos existentes nem emite protocolo nesta fase |

## Alteração técnica

`apps/api/src/traffic-citizen-identity-v516.ts` cria apenas a verificação **interna** entre sessão comprovada e dados de visitante. Um cliente não pode declarar `registered:true`, `citizenId` ou `login` para adquirir privilégios. A sessão inválida falha fechada, mesmo com campos de visitante preenchidos; essa é uma proteção interna contra degradação silenciosa da autenticação, não uma tela/regra nova.

`tests/traffic-citizen-identity-v516.test.mjs` contém 11 cenários de paridade/segurança com **dados fictícios**.

### Limites obrigatórios da entrega

- O `CitizenSessionResolverV516` é uma interface que precisa ser conectada ao **sistema real e revisado** de cadastro/sessão/moderação V5.16. **Não há implementação desse resolvedor em produção.**
- O backend existente em `main` utiliza identidade por e-mail, enquanto o cadastro original do Cidadão V5.16 utiliza login/senha, nome, nascimento, telefone e referência na Vila. **Não trocar o fluxo original por e-mail/código sem revisão/autorização.**
- Visibilidade do protocolo do visitante no HTML depende de `deviceId`; o vínculo seguro de dispositivo/visitante no servidor **ainda não está implementado**.
- Não há rota HTTP de denúncia, criação de protocolo PostgreSQL, aprovação de evidência, identidade real validada, acesso de Guarda/SEMUS funcional nem homologação móvel.
- As PRs #15–#21 são DRAFT e sua revisão anterior não concede merge. `main` e VPS não foram alterados; não publicar tokens/senhas ou dados pessoais.

## Próximo passo seguro

1. Conciliar autenticação/cadastro do Cidadão original com a infraestrutura de identidade sem alterar formulário, login/senha ou permissões V5.16.
2. Implementar a vinculação segura do visitante ao dispositivo/recuperação de seus próprios protocolos, respeitando a visibilidade original, sem dados pessoais reais.
3. Integrar o arquivo normalizado/varrido a uma transação PostgreSQL com **um único protocolo canônico**, exigindo autorização no servidor; só retornar ID após confirmação da transação.
4. Conectar React Native/ADM à mesma fonte, testar em infraestrutura JeriFlow separada e em dispositivos; nenhum merge/deploy sem autorização.
