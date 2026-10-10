# JeriFlow V5.16 — fase 6: varredura antimalware interna sem emissão de protocolo

## Fonte conferida antes da implementação

ZIP `JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip`, SHA-256 `89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad` (integridade do ZIP testada). Referências:

- `cidadao-ai/index.html` linhas 659–706: `#trafficForm`, sete tipos exatos, local, placa opcional, descrição, câmera/galeria, foto e identificação; botão de envio.
- `cidadao-ai/index.html` `submitTrafficForm()` e `shared/jeriflow-audit-citizen.js` `submitTrafficForm()`: envia **um protocolo** para `SEMUS / Guarda de trânsito`, status inicial `RECEBIDA`, somente após foto válida.
- `shared/jeriflow-audit-citizen.js` `evidence(file)` e `imageFileToData(file,1200,.7)`: limite de entrada de **8 MiB**, largura 1.200 px e qualidade 70%.
- `guarda-semus/index.html` `acceptReport()`/`finishBtn` e `admin-semus/index.html` `reopen()`/`closeAdmin()` operam a mesma ocorrência do Cidadão.

## Mudança exclusivamente técnica desta etapa

O módulo interno `apps/api/src/traffic-photo-malware-v516.ts` é um cliente para o daemon **ClamAV clamd em socket Unix privada**, protocolo INSTREAM: o arquivo limpo e privado da PR #20 é lido por ID e município, conferido com SHA-256, transmitido em blocos e analisado. Somente a resposta exata `stream: OK` permite retornar o recibo de varredura limpa. `FOUND`, indisponibilidade, timeout, respostas inválidas e alteração dos bytes interrompem o processo, sem emitir protocolo ou liberar mídia.

O retorno permanece `evidenceApproved:false`, `protocolCreated:false`, `publicUrl:null`. `malwareScanned:true` significa apenas que a resposta do daemon para esses bytes foi limpa; **não** afirma segurança absoluta, aprovação da prova, autorização do denunciante ou homologação. Não existe nova tela, estado de negócio, campo obrigatório, pagamento, PSP, API, conta, tabela ou workflow da Guarda.

`tests/traffic-photo-malware-v516.test.mjs` testa a comunicação em socket Unix usando servidor sintético de testes, bloqueios e mutação de arquivo. **Não existe ClamAV real instalado nem teste com assinaturas oficiais nesta fase**. Este módulo ainda não está integrado ao HTTP, à identidade, ao banco ou a apps.

## Próxima fase restrita à V5.16

Verificar a identidade/sessão do cadastrado **ou** visitante identificado, a moderação e o município; configurar daemon real em ambiente próprio do JeriFlow; garantir recebimento de evidência com varredura e associação transacional no PostgreSQL ao **mesmo** protocolo do Cidadão, usado pela Guarda/SEMUS. Testar sem dados reais; preservar a `main`, o VPS de outros projetos e todas as PRs anteriores.
