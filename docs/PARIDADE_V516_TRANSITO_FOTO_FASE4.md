# JeriFlow V5.16 — Fase 4: decodificação real e remoção de metadados da fotografia

**Fonte obrigatória consultada antes do código:** `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`.

## Prova de correspondência HTML

| Fonte V5.16 | Comportamento existente | Correspondência técnica |
|---|---|---|
| `cidadao-ai/index.html`, `trafficCameraInput` e `trafficGalleryInput` | Recebe foto de câmera ou galeria, inclusive cidadão visitante identificado | Processa JPEG, PNG, WebP e GIF aceitos pela triagem da fase anterior; HEIC/HEIF/AVIF somente quando o decodificador os suportar, falhando fechado caso contrário |
| `shared/jeriflow-audit-citizen.js`, `evidence(file)` | Rejeita foto acima de **8 × 1024 × 1024 bytes** | Respeita o mesmo teto na entrada bruta |
| `shared/jeriflow-audit-citizen.js`, `imageFileToData(file,1200,.7)` | Normaliza visualmente para largura máxima de **1.200 px**, qualidade **0,7** e representação em imagem | Redimensiona preservando proporção, corrige orientação de câmera e reencoda em WebP qualidade **70**, removendo EXIF, GPS, XMP, perfil ICC e outros metadados |
| `submitTrafficForm()` e `persistCitizenProtocol()` | Somente foto obrigatória processada é anexada ao protocolo canônico Trânsito (SEMUS) | Esta PR entrega somente Buffer normalizado **interno**; não insere protocolos, não publica imagens e não cria evidência aprovada |

## Implementação

- `apps/api/src/traffic-photo-normalize-v516.ts` adiciona uma etapa de processamento por Sharp após a quarentena da PR #18. O processador:
  - exige ID de quarentena válido na instância controlada pelo servidor;
  - confere assinatura e SHA-256 previamente calculados;
  - lê metadados para validar dimensões e reconhece o formato real;
  - decodifica o conteúdo da imagem e falha diante de JPEG/PDF/SVG falsos, arquivo truncado ou formato sem decodificador instalado;
  - impede decompression bomb por limite técnico de 80 milhões de pixels (para contemplar sensores de 48 MP sem confundir proteção contra descompressão com regra funcional do HTML) (não muda formulário/limites municipais);
  - orienta a foto pelo EXIF, reencoda com WebP qualidade 70 e largura máxima 1.200 sem ampliar fotos pequenas;
  - verifica a ausência de campos EXIF/XMP/ICC/IPTC/orientação no arquivo resultante, com hash SHA-256.
- `apps/api/package.json`: declara Sharp diretamente como dependência da API; lockfile já possuía Sharp 0.35.4 como dependência indireta do Next.js e passou a registrá-lo no workspace API.
- `tests/traffic-photo-normalize-v516.test.mjs`: testes com fotos geradas de verdade por Sharp, JPEG/PNG/GIF/WebP, EXIF real, orientação, fonte falsificada, arquivo inexistente e não emissão de protocolo.
- O CI dedicado executa também as suítes de domínio, triagem da foto e quarentena, mais TypeScript.

## Fronteiras de segurança e de escopo

**Não implementado:** rota de upload, token público, isolamento por município no armazenamento definitivo, varredura antimalware, armazenagem da versão sanitizada, verificação LGPD, criação do protocolo em PostgreSQL ou a navegação real no App Cidadão. Não usar dados pessoais reais nesta etapa. Não pressupor que imagem decodificada está livre de conteúdo malicioso.

O retorno é **somente um resultado interno**: `imageDecoded:true`, `metadataRemoved:true`, mas **`stored:false`, `malwareScanned:false`, `evidenceApproved:false`, `protocolCreated:false`**. Não disponibilizar o `bytes` retornado por endpoint ou log, nem marcar uma denúncia como recebida.

### Próxima etapa fiel à V5.16

Após confirmar os testes desta PR, criar o armazenamento privado da foto normalizada e a persistência transacional do protocolo canônico em PostgreSQL. O mesmo ID deverá ser usado pelo Cidadão, Guarda e ADM SEMUS. O fluxo precisa aceitar a identidade do cidadão cadastrado e a do visitante identificado, sem exigir integração externa ou provedor financeiro.

**Integração:** PR #16 → #17 → #18 → nova PR, todas rascunho. `main`, contas, VPS do Ramo Nessa e aplicativos já existentes permanecem intocados. Repositório público por decisão do proprietário: não versionar segredos ou fotos reais.
