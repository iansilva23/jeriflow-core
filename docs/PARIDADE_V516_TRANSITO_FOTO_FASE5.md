# JeriFlow V5.16 — Fase 5: mídia normalizada em armazenamento privado

**Fonte funcional obrigatória inspecionada diretamente:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`.

## Paridade documentada com o HTML

| Fonte HTML V5.16 | Regra preservada |
|---|---|
| `cidadao-ai/index.html`, `#trafficCameraInput` e `#trafficGalleryInput` | Foto capturada pela câmera **ou** galeria |
| `shared/jeriflow-audit-citizen.js`, `evidence(file)` | Máximo **8 MiB** de arquivo na entrada original |
| `shared/jeriflow-audit-citizen.js`, `imageFileToData(file,1200,.7)` | Imagem redimensionada para no máximo **1.200 px de largura** e qualidade 0,7 antes de ser associada ao protocolo |
| `persistCitizenProtocol()` | A denúncia de trânsito usa **um protocolo canônico**; a mesma identificação alimenta Cidadão, Guarda e ADM SEMUS |

Esta PR não acrescenta tela, formulário, categoria, estado, cobrança ou processo de aprovação da V5.16. Implementa somente persistência técnica interna da imagem já sanitizada.

## Arquivos desenvolvidos

- `apps/api/src/traffic-photo-clean-store-v516.ts`: armazena somente WebP anteriormente decodificado e normalizado pela PR #19, com SHA-256 e checagem independente dos metadados.
- Diretório raiz deve estar criado e com permissões **0700**; arquivos por município em subpasta **0700**, com imagem e manifesto internos **0600**, nomes UUID gerados pelo servidor.
- O manifesto contém somente identificação técnica do município, ID aleatório, dimensões, tamanho, formato e SHA-256: **sem identidade, CPF, placa, credenciais, URL ou imagem bruta**.
- O armazenamento resiste a reinício do processo e recusa alterações nos bytes, manifesto inválido, acessos entre municípios e caminhos malformados.
- Como endurecimento técnico, a imagem WebP deve ser **decodificada integralmente**, não apenas reconhecida por cabeçalho. Imagens truncadas ou animadas são recusadas e não entram no armazenamento privado. Isso não altera os campos nem o fluxo funcional do HTML V5.16.
- Testes cobrem persistência, reinicialização, integridade, EXIF removido, symlink de raiz, limite da mídia, diretórios inseguros, isolamento municipal e descarte da amostra antes da criação oficial do protocolo.
- Workflow GitHub Actions executa todas as suítes anteriores da V5.16, a suíte desta fase e TypeScript.

## Não representa evidência aprovada

O ticket de imagem normalizada declara `stored:true` e `normalized:true`, pois o servidor interno gravou o arquivo limpo; **obrigatoriamente** mantém `malwareScanned:false`, `evidenceApproved:false`, `protocolCreated:false`, `publicUrl:null`.

**Não há:** upload público, interface de envio, autorização do cidadão/visitante, API de imagens, registro no PostgreSQL, scanner antimalware, aceite jurídico/LGPD nem protocolo efetivamente registrado.

A separação entre pasta bruta de quarentena e arquivo limpo impede que dados de GPS/EXIF originais sejam expostos como evidência. Entretanto, a segurança operacional completa exige controle do host, malware scanning, backup, retenção, isolamento por processo e autorização server-side.

O método `discardUnlinked` serve apenas para desfazer um arquivo de teste ou tentativa abandonada **antes de vinculação oficial ao protocolo**; não será exposto à interface do Cidadão.

## Próxima etapa obrigatória

1. Revisar integralmente formulário original `trafficForm` e `submitTrafficForm()` incluindo visitante identificado e cidadão cadastrado.
2. Implementar verificação do usuário/município no servidor e o vínculo transacional entre identidade, protocolo canônico e arquivo interno sanitizado.
3. Implementar **uma única fonte de protocolos** no PostgreSQL: Guarda/SEMUS operam esse mesmo ID; não criar tabela de ocorrências paralela.
4. Executar integração real PostgreSQL e testes no navegador/app, sem dados pessoais reais nem movimentações financeiras.
5. Planejar LGPD, retenção, varredura antimalware e implantação de JeriFlow **separada** do VPS de outro projeto antes de produção.

PR DRAFT, base PR #19. Nenhum merge na `main`, nenhum servidor alterado e nenhum recurso fora do HTML V5.16.
