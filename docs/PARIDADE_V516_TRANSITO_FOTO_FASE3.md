# JeriFlow — V5.16 / Fase 3: quarentena técnica da foto obrigatória de trânsito

## Origem obrigatória (conferida antes de programar)

Pacote `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`,
SHA256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad`.
- `cidadao-ai/index.html`, `#trafficForm` linhas 655–709: permite câmera e galeria; exige foto.
- `shared/jeriflow-audit-citizen.js`:
  - `evidence(file)`, limite **8×1024×1024 bytes**, mensagem `Arquivo acima de 8 MB.`
  - `submitTrafficForm()`: requer foto + formulário + identificação do cidadão cadastrado **ou visitante**.
  - `imageFileToData(file,1200,.7)`: redimensionamento e conversão técnica do protótipo para armazenar no navegador local. No backend real, a transformação deve reproduzir aparência e descartar metadados antes do registro oficial.
  - `persistCitizenProtocol`: fonte única do protocolo `Trânsito (SEMUS)`, jamais tabela de ocorrências Guarda paralela.

## O que está implementado

`apps/api/src/traffic-photo-quarantine.ts` oferece apenas um **componente interno**, sem endpoint público:
- Abre somente diretório privado **já provisionado** com modo Unix 0700, não aceita diretório inexistente, symlink ou compartilhado.
- Recebe bytes e MIME, valida assinatura/teto de **8 MiB** pela etapa anterior, grava amostra com nome UUID e arquivo 0600 sob `O_EXCL/O_NOFOLLOW`.
- Mantém digest SHA-256 e checa integridade na leitura interna para eventual higienizador confiável.
- Retorna ticket que **não** contém caminho, URL, arquivo/assinatura aprovada ou protocolo.
- Oferece descarte explícito e remoção controlada de órfãos antigos em reinício do worker, sem apagar amostras em uso.
- Os resultados são sempre `state:"quarantined_unverified"`, `imageDecoded:false`, `metadataRemoved:false`, `malwareScanned:false`, `evidenceApproved:false`, `protocolCreated:false`.
- Testes isolados, incluindo permissão, leitura, troca de conteúdo, symlink, path traversal, idempotência, exclusão e limite do original.

## O que NÃO foi implementado (restrições obrigatórias)

Esta etapa **NÃO fornece captura HTTP, base PostgreSQL, cadastro, decodificador de imagem, remoção de EXIF/GPS, scanner antimalware, evidência armazenada definitivamente nem protocolo real**. Guardar bytes em quarentena **não torna a imagem segura**.

O `TrafficPhotoQuarantineV516` é uma unidade de infraestrutura a ser ligada futuramente a um worker protegido:
1. O backend deverá aceitar apenas a câmera/galeria dentro do formulário original, **também para visitante identificado**.
2. Checar upload por streaming e limites sem esgotamento de memória, associando-o ao contexto da denúncia/identidade.
3. Decodificar efetivamente JPEG/HEIC/etc. em ambiente isolado, corrigir orientação, gerar imagem normalizada (redimensionamento do HTML: 1200 e qualidade .7) e eliminar EXIF/GPS/metadados.
4. Varredura real e armazenamento privado autenticado, com lifecycle/retenção e LGPD antes de declarar `evidenceApproved`.
5. Registrar protocolo canônico em transação PostgreSQL, referenciando evidência verificada; Guarda e SEMUS consultam o **mesmo ID**.
6. Validar E2E em VPS **própria do JeriFlow**, Android/iOS físicos e navegador, sem dados reais durante homologação.

O componente de quarentena é intencionalmente **não integrado a rotas ou interface** para impedir vazamento ou falsa confirmação enquanto esses requisitos não forem cumpridos.

## Publicação e preservação

PR DRAFT encadeada após PR #17. Não modificar `main`, credenciais, apps existentes, nem VPS do Ramo Nessa. O repositório permanece público por decisão do proprietário, então nunca versionar dados pessoais reais. Não adicionar integrações financeiras/PSP ou fluxos ausentes do ZIP V5.16.
