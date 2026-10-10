# Entrega 1 — Contrato de Trânsito fiel à V5.16 (SEM implementação de backend/IO)

**ZIP primário:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`
**SHA256 validado:** `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`
**Base GitHub:** `main` em `7a314c287823dc344c094b893178b500fc3777ab`.

## O que foi implementado nesta entrega

Somente **contrato puro de domínio** em `packages/contracts/src/citizen-traffic-v516.ts`, com testes em `tests/citizen-traffic-v516.test.mjs`.

1. Validação da tela `trafficForm` do App Cidadão: sete tipos originais, local, descrição, **foto selecionada**, identidade com nome/data de nascimento/telefone, placa opcional limitada a oito caracteres e conversão em maiúsculas.
2. Ordem e textos de falha de `submitTrafficForm()` e bloqueio administrativo de `citizenSubmissionAllowed()` (parâmetro externo de entrada).
3. **Contrato de protocolo canônico**, sem criação de ID em outra entidade: `category:"Trânsito (SEMUS)"`, `destination:"SEMUS / Guarda de trânsito"`, status `RECEBIDA`, dados da ocorrência e `hasPhoto:true`.
4. **Contrato de Guarda**: assumir o mesmo ID (`EM ATENDIMENTO`), preencher a situação encontrada e providência com **opções originais** e finalizar (`FINALIZADA`), conservando histórico.
5. **Contrato do ADM SEMUS**: reabrir a mesma ocorrência sem apagar o histórico, ou finalizar administrativamente com motivo.
6. Sinalização de possível trote para **análise**, sem punição/bloqueio automático.
7. Testes de paridade e de estados inválidos. Workflow em branch distinta, sem tocar em servidores.

## Prova direta do HTML

| Arquivo HTML V5.16 | Elemento | Contrato implementado |
|---|---|---|
| `cidadao-ai/index.html` | `#trafficForm` ~656–710, `#trafficType`, `#trafficLocation`, `#trafficPlate`, `#trafficDescription`, inputs câmera/galeria | Validações / opções / placa |
| `cidadao-ai/index.html` | `readFormIdentity()` ~1335 | Identidade civil vinculada |
| `cidadao-ai/index.html` | `citizenSubmissionAllowed()` ~1336 | Respeita bloqueio de moderação |
| `cidadao-ai/index.html` | `submitTrafficForm()` ~1460–1465 | Mensagens e criação canônica após foto válida |
| `guarda-semus/index.html` | `allTraffic()` ~492; `acceptReport()` ~512 | Mesma origem e mesmo protocolo |
| `guarda-semus/index.html` | `#serviceResult`, `#serviceAction`, `#finishBtn` ~455–465, ~519 | Opções/estado final |
| `admin-semus/index.html` | `reopen()` ~172, `closeAdmin()` ~178 | Reabertura e encerramento com motivo |

## O que NÃO está implementado (não confundir com app pronto)

- Esta entrega **não** cria rota HTTP, banco, upload de foto, armazenamento ou notificações.
- `photoSelected:true` comprova somente a escolha da foto na UI; **não** comprova que os bytes chegaram ao servidor. A função `trafficProtocolAfterVerifiedPhotoV516` exige sinal explícito do **adaptador de backend confiável** indicando evidência armazenada e validada antes de construir o registro. Esse parâmetro, isoladamente, não é mecanismo de autenticação.
- Usuários/perfis/municípios reais ainda não são conectados ao modelo. A autorização deve ocorrer no servidor dentro do desenho de identidade que será reconciliado com a V5.16.
- Não há telas RN novas nesta PR, para não exibir uma ação de "enviar denúncia" que não grava nada nem captura fotografia com segurança.
- Os eventos de domínio atuais são **valores em memória e retornos imutáveis**, não um sistema de auditoria transacional.
- Não existe PSP, pagamento, tarifa, voucher ou fonte paralela da Guarda.

## Próxima entrega permitida, após consulta ao mesmo ZIP

1. Criar **captura e armazenamento seguros da foto de denúncia**, com verificação real de conteúdo e isolamento municipal, sem mudar a obrigação de anexá-la ao protocolo no envio.
2. Implementar registro canônico no servidor, validando autorização, campos e existência de foto efetiva; manter o **mesmo ID** em Cidadão, Guarda e ADM SEMUS.
3. Conectar as telas React Native e painéis com os papéis/estados do HTML; testar ponta a ponta. Nenhum dado pessoal real antes de homologação.

### Critérios de segurança e mudança

Preservar `main`, apps existentes, PR #15 e os commits antigos de engenharia para seleção pontual. Esta PR é **DRAFT** até teste no HEAD e revisão de paridade; não executar merge automático. Sem VPS ou dados pessoais reais. Não expandir a funcionalidade sem referência original.
