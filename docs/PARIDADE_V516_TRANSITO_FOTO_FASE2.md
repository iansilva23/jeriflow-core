# JeriFlow V5.16 — Fase 2: inspeção de foto da denúncia de trânsito

**Fonte única revisada antes da implementação**: `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`,
SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`.

## Correspondência exata com o HTML aprovado

| HTML V5.16 | Regra funcional | Correspondência nesta fase |
|---|---|---|
| `cidadao-ai/index.html`, `#trafficForm`, linhas 655–709 | Denúncia de trânsito exige foto antes de enviar | Candidato só é inspecionado quando bytes são fornecidos |
| `#trafficCameraInput`, `accept="image/*"`, `capture="environment"`, linha 696 | Foto tirada na câmera | Inspeção independe da origem, recebe bytes reais |
| `#trafficGalleryInput`, `accept="image/*"`, linha 697 | Foto selecionada da galeria | Mesma inspeção; contempla HEIC/HEIF/AVIF comuns em celulares |
| `setTrafficPhoto(file,source)`, linhas 1444–1458 | Rejeita tipo que não é imagem; mostra prévia | Rejeita tipos não reconhecidos mesmo com MIME/extension declarados como imagem |
| `submitTrafficForm()`, linhas 1460–1465 | Foto obrigatória e protocolo só depois de formulário válido | Continua bloqueada a emissão de protocolo sem **upload/armazenamento válido** na etapa posterior |

## Código construído

- `apps/api/src/traffic-photo-candidate.ts`: verifica limites técnicos de tamanho e assinatura inicial de JPEG/PNG/WebP/GIF/HEIC/HEIF/AVIF; detecta cabeçalho ou conteúdo não condizentes com o MIME anunciado; calcula SHA-256 do candidato.
- `tests/traffic-photo-candidate-v516.test.mjs`: inspeciona os formatos, a foto sem declaração de MIME, arquivos com texto disfarçados de JPEG, declarações contraditórias, truncamento, dimensões inválidas e limite técnico de 10 MiB.
- Teste anterior do contrato da denúncia/Guarda/SEMUS executado novamente no mesmo CI.
- Nenhuma dependência nova, integração de pagamento, API HTTP, tela, regra de negócios ou alteração em `main`.

## AVISO CRÍTICO: a imagem ainda não está aprovada nem salva

A função `examineTrafficPhotoCandidate` identifica somente a **estrutura inicial do arquivo**, sem assegurar decodificação completa ou inocuidade. **O resultado sempre retorna** `trust:"untrusted"`, `stored:false`, `scanned:false`, `metadataRemoved:false`, `protocolCreated:false`.

**NÃO** considerar a imagem válida para criação de protocolo e **NÃO** expor o conteúdo em URLs públicas. A próxima implementação deverá:
1. Decodificar realmente e normalizar a fotografia, removendo EXIF/GPS/metadados.
2. Fazer a varredura de conteúdo exigida pela política técnica em área privada e isolada.
3. Garantir autenticação/vínculo para cidadão cadastrado **OU** cadastro de identificação do visitante, porque os dois fluxos existem na V5.16.
4. Persistir a evidência e o protocolo canônico em transação idempotente; SEMUS/Guarda usarão o mesmo ID.
5. Validar em PostgreSQL real e navegador/aparelhos sem dados pessoais reais.

O limite de 10 MiB é um teto técnico defensivo para testes, NÃO nova cobrança, política municipal ou alteração do tipo de denúncia. Imagens maiores exigirão um fluxo técnico de compressão/normalização no aplicativo, com resultado visual preservado.

**PR DRAFT**, sem publicação, sem merge e sem uso de dados de cidadãos reais.
