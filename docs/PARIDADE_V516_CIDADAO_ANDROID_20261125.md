# F02 — Cidadão Android: prova funcional e ajustes pontuais da V5.16

Estado documentado em 25/11/2026. **F02 parcial.** Sem merge, deploy, produção ou dados reais.

## Prova funcional anterior à correção visual

PR #116, branch continuity/f02-citizen-traffic-e2e-20261114. Commit 175b58f29d5c41e4e4952898387e4013e32afa74. [CI 45682078486](https://github.com/iansilva23/jeriflow-core/actions/runs/45682078486): todos os cinco jobs aprovados — android, postgres-clamd-real e android-smoke para gallery, files e camera. Cada emulador selecionou/capturou imagem sintética, exibiu prévia, enviou a denúncia e confirmou o mesmo protocolo com foto no PostgreSQL. Esta evidência se refere ao commit indicado, não automaticamente a revisões posteriores.

A câmera usa hw.camera.back=emulated e hw.camera.front=none: nenhuma webcam ou imagem de pessoa real foi usada. O artefato camera 15054134757 tem digest SHA256 d028ebc5d9919efe72faf7e2fc532cc0c450d93b1b8389e8021c4b40b5e2ba52 e report.json com status passed, photoSource camera e photoPreviewVisible true. Logs HTTP registram multipart e retorno 200. Artefatos remotos do teste expiram em 28/11/2026; o pacote de continuidade preserva a prova recuperada.

## Referência da correção visual nesta revisão

ZIP original SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad revalidado antes da edição. Fonte: cidadao-ai/index.html, seção #trafficForm, .choice-grid, .choice-btn, .required, .form-photo-preview, CSS final jf-premium-mobile dos campos.

- Câmera e Galeria voltam a ser opções brancas com borda e ícones, lado a lado, preservando os rótulos acessíveis. Arquivos continua disponível no Android.
- Reposta a legenda original Foto pronta para envio. sob a prévia.
- Asteriscos obrigatórios recuperam a cor da referência; campos recuperam fundo branco, borda #D8E4E7 e raio 14 do CSS final.
- Alvos de toque continuam com mínimo 44, bloqueio durante seleção/envio e fontes legíveis do aplicativo nativo. Não há alteração de validação, autenticação, contrato HTTP nem persistência.
- O runner registra capturas e hierarquias das etapas form-filled, photo-preview e protocol-confirmed somente na execução opt-in com fixtures fictícias. Confere o pacote do app em primeiro plano e recusa campos de credenciais ainda preenchidos. Cada PNG fica associado ao SHA256 no relatório.

## Validação local e limites

TypeScript Cidadão, sintaxe dos scripts e diff conferidos. 14 testes de autenticação/slots e 12 testes do runner aprovados. Bundle Android Metro de 614 módulos exportado. A revisão alterada ainda requer nova matriz completa de emuladores e inspeção das capturas; a aprovação do commit anterior não substitui esse teste.

Não há aprovação de paridade visual integral: gradientes/sombras, tipografia e dimensões, identidade de cadastrado/visitante, botão Voltar e navegação original ainda precisam de conferência e integração. A captura local do HTML original não foi produzida: o wrapper Chromium existente não possui binário e a instalação do navegador foi recusada pela rede (403). Não foi gerada imagem substituta. Providenciar renderização real do original em ambiente de teste permitido e comparar as mesmas dimensões antes de homologar visual.

Continuam pendentes: visitante com prova segura de posse, PWA iPhone/web, integração completa da navegação V5.16 e homologação física. Os testes deste documento comprovam o caminho sintético da conta cadastrada. A tela de vínculo técnico não representa a experiência final V5.16.
