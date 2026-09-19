# JeriFlow — base técnica validada; backend em desenvolvimento

Este pacote não é o produto pronto. Não publicar nem inserir dados reais.
O status completo e os limites estão em docs/ETAPA_2.md.

Para continuar pelos testes na nuvem, leia [COMECE_AQUI.md](COMECE_AQUI.md).
A conta GitHub foi conectada e o acesso de escrita ao repositório privado
[iansilva23/jeriflow-core](https://github.com/iansilva23/jeriflow-core) foi confirmado.
A base foi enviada e a bateria completa teve uma execução remota aprovada,
incluindo PostgreSQL/Redis reais. As evidências e o histórico estão em
[docs/TESTES_NA_NUVEM.md](docs/TESTES_NA_NUVEM.md). Os quatro apps também foram
compilados e abertos duas vezes cada no iPhone Simulator. A Etapa 2 está
concluída no escopo técnico: os quatro Android também compilaram, foram
instalados e abriram duas vezes. A preparação corrigida foi validada nas
execuções 35379274017 e 35380520136. As falhas anteriores estão preservadas;
as funções de negócio continuam em desenvolvimento. Evidências e limites em
[docs/VALIDACAO_NATIVA.md](docs/VALIDACAO_NATIVA.md).
O diagnóstico VERIFICAR_MAC.command continua disponível como alternativa local.

## Componentes

Quatro apps Expo/React Native: Cidadão, Turista, Guarda/SEMUS e Fiscal TTS.
Administrativo Next.js: Mestre, Turismo/Estacionamento, Cidadão/Ouvidoria,
SEMUS, Conteúdo, Dashboard e Studio. Backend TypeScript com diagnóstico local
e núcleo de identidade. Implementação e limites em [docs/IDENTIDADE.md](docs/IDENTIDADE.md).

Compartilhar código administrativo NÃO compartilha permissões. As autorizações
operacionais serão aplicadas no backend antes de conectar dados reais.
Não há app Transporte separado; essa função pertence ao Turista/Admin Turismo.

## Preparação reproduzível

Requer Node 24.15 ou superior da série 24. O projeto fixa npm 12.0.2.
Na pasta deste README:

    npm run setup
    npm run check
    npm run verify

setup instala pelo lockfile, usa npm fixado sem alterar o npm global e não roda
scripts de instalação de terceiros. Requer rede. Não usar npm audit fix --force.
O npm 11.9.0 observado neste ambiente não resolveu corretamente o override antigo.

verify compila e testa a base, gera docs/VERIFICATION.json e falha se uma
verificação falhar. Não contrata serviços, inicia nuvem nem publica apps.
Prepara segredos locais quando ainda não existem e testa banco/cache locais;
se os serviços não estiverem rodando, a falha de infraestrutura é esperada.
Logs ficam em artifacts/. Não compartilhar arquivos de segredos ou logs sem revisão.

## Banco local — requer Docker com Compose

    npm run infra:up
    npm run infra:check
    npm run infra:status
    npm run infra:down

up prepara credenciais aleatórias, baixa imagens e inicia apenas containers locais.
PostgreSQL usa 127.0.0.1:55432 e Redis 127.0.0.1:56379. Usuário da API não é
administrador do banco. down para os containers sem apagar volumes/dados.
Não apagar volumes para resolver erros sem avaliar e preservar os dados.
Os segredos locais não substituem gestão de segredos em produção.

## Abrir a base

    npm run dev:api

API em http://127.0.0.1:3001. Em outro terminal:

    npm run dev:admin

Administrativo em http://127.0.0.1:3000. As sete páginas são avisos de desenvolvimento,
não painéis de negócio com login. Sem usuários ou senhas padrão.

/health/live confirma apenas o processo; /health/dependencies testa banco/cache;
/health/ready permanece 503 enquanto identidade e backend operacional não existem.
Rotas de identidade e acesso estão descritas em docs/IDENTIDADE.md. As demais
rotas /api/v1 respondem NOT_IMPLEMENTED; não simulam validação oficial da TTS.

## Apps

    npm run mobile:cidadao
    npm run mobile:turista
    npm run mobile:guarda
    npm run mobile:fiscal

Iniciar um por vez. O servidor Expo pode anunciar acesso pela rede local: usar
somente rede confiável e dados fictícios. Os apps ainda não chamam a API.
npm run build:mobile gera oito bundles Android/iOS, não APKs/IPAs.
Os identificadores com.example são temporários, não destinados às lojas.
Builds nativos exigem Android SDK e, no caso iOS, macOS/Xcode ou serviço aprovado.

## Verificação e recuperação

npm run doctor verifica ferramentas sem instalá-las. Não substitui compilar e abrir
o app. A entrega contém código, testes, lockfile, configuração e relatórios; não contém
dados, credenciais, node_modules, projetos nativos gerados ou instaladores dos apps.

O V5.16 original não foi alterado. Não migrar dados do protótipo para esta base ainda.
