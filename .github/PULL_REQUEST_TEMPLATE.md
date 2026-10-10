# Checklist obrigatório — Paridade V5.16 (JeriFlow)

> Antes de abrir/mesclar uma PR: **abrir o ZIP original V5.16** e demonstrar que a alteração só reproduz funcionalidades existentes no HTML. O modelo não poderá criar funcionalidades novas sem autorização explícita do proprietário.

## Correspondência V5.16 — preenchimento obrigatório
- **ZIP original e SHA-256 conferidos:** 
- **Aplicativo/painel HTML original:** 
- **Arquivo(s), função(ões), ID(s) de tela/campo na V5.16:** 
- **Estados, validações, regras e exceções reproduzidos:** 
- **Código correspondente neste PR:** 
- **Casos de teste de equivalência (incluindo negativa/permissões):** 

## Integridade e regressão
- [ ] Não criei nova tela, campo, estado, preço, canal, integração ou fluxo ausente da V5.16.
- [ ] Preservados direitos de acesso e responsabilidades da tela HTML original.
- [ ] Não criei fonte paralela de dados ou outra entidade para o mesmo registro.
- [ ] Validei se a função já havia sido implementada em outra branch/PR.
- [ ] Os testes com a implementação atual passaram **no commit final**.
- [ ] Não alterei `main` nem dados/ambientes de produção sem autorização.
- [ ] Não publiquei credenciais, dados pessoais ou configurações sigilosas no repositório público.

Se uma correspondência não puder ser indicada com precisão, **deixe como DRAFT/bloqueada e não faça merge**.

Fonte mandatória: `docs/REGRA_SUPREMA_PARIDADE_V516.md` e `docs/AUDITORIA_PARIDADE_PR6_PR7_PR8_V516.md`.
