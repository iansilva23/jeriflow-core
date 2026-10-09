# JeriFlow Ouvidoria — critérios de aceite visual (09/10/2026)
Ambiente: PostgreSQL, Redis e Mailpit locais e descartáveis, Next.js real, Chromium Playwright headless e API Node local. Nunca VPS/producao.

O teste `tests/ouvidoria-browser/run.mjs` cria somente municípios/contas fictícios, marca email verificado somente nas fixtures, ativa MFA por código TOTP real para servidores e usa sessão HttpOnly no Chromium. Confere os 12 controles: bloqueio anônimo, bloqueio cidadão no painel, MFA prévio, protocolo criado pelo cidadão, fila autenticada, assumir, responder, encerrar, isolamento entre municípios, CSRF, revogação de perfil e persistência de auditoria.

Nenhuma senha, token, código MFA ou estado de sessão do navegador é salvo como evidência. Capturas têm máscaras dos campos e do conteúdo textual dos protocolos, e o relatório contém apenas resultado e IDs de controle. Logs são limitados e o teste remove apenas suas próprias fixtures. Falhar qualquer controle mantém a etapa reprovada.

**Limitações:** browser local não substitui uso em VPS HTTPS nem teste Android/iOS instalados; fotos ainda não são aceitas. A etapa não autoriza tratar denúncias reais ou integrar o servidor da prefeitura.
