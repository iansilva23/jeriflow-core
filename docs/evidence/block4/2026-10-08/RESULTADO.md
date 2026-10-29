# Bloco 4 — preservação da homologação técnica do CI

Recuperado em 27/10/2026. Escopo: execução histórica de 08/10/2026, sem nova execução.

- Execução [37824466140](https://github.com/iansilva23/jeriflow-core/actions/runs/37824466140), commit `f042e208c9ecaf33759fa8f3004cdafa502ac8ec`: **43 PASS / 0 FAIL / 0 BLOCKED**. Chromium, API/Next e PostgreSQL/Redis/Mailpit no runner isolado.
- `report.json` conserva cada controle, método, captura e checksum. Foram examinadas 153 respostas sem violações pelos controles aplicados; o relatório registra zero erros do navegador.
- ZIP original final, preservado LOCALMENTE no pacote de continuidade: 44 PNGs, dois logs locais curtos e relatório; CRC e hashes de todas as capturas referenciadas conferidos. `preservation.json` registra proveniência e hashes dos ZIPs. A captura adicional `42-conflict.png` é preservada pelo hash do ZIP; não tem hash individual no relatório.
- Primeira execução [37823479021](https://github.com/iansilva23/jeriflow-core/actions/runs/37823479021): **5 PASS / 1 FAIL / 37 BLOCKED**, por seletor incorreto “Operação”. Não converter em falha de produto. Original preservado separado.
- Bug real identificado naquela rodada: pattern municipal incompatível com modo `v`. Correção/regressão no commit `f042e208...`, preservando a regra backend; relatório registra sete casos no Chromium. Não reaplicado nesta retomada.
- 77 testes locais/typecheck: alegação histórica do prompt mestre; relatório local original não recuperado. `local-validation.json` distingue essa informação do resultado original do CI. Não reconstruí um PASS inexistente nem repeti a suíte.
- Máscaras de captura verificadas no roteiro histórico (inputs, `.secret`, `.recovery`); sem HAR/trace/storage state. Captura 03 inspecionada na retomada. Os ZIPs são os originais sanitizados da execução e ficam somente no pacote local de continuidade. A revisão automática recusou o envio dessas capturas ao repositório público; esta versão remota contém somente documentação, relatórios sanitizados e hashes. Logs completos do runner não são versionados.

## Limites e divergências

Aprovação técnica da implementação existente; **não** paridade integral com a V5.16, VPS, aparelho físico ou produção. A PR #2 foi posteriormente fechada sem merge após auditoria de paridade de identidade. O fechamento não apaga os resultados técnicos; estes não autorizam incorporar as mudanças da PR #2 como aceite V5.16.

O usuário informou em 27/10/2026 que por enquanto tudo é feito no GitHub. A recuperação e conferência local do CI estão concluídas neste escopo; o critério VPS da F01 original permanece adiado. Não há liberação de produção.
