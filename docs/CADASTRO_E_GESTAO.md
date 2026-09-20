# Bloco 4 — cadastro e gestão de contas

Bloco 4 APROVADO no ambiente de desenvolvimento em 20/09/2026. Isso não é
aprovação para produção, uso com dados reais ou homologação em aparelhos físicos.
O bloco 3 permanece documentado em `TELAS_AUTENTICACAO.md`; seus resultados
históricos não foram usados como substituto desta validação.

## Evidência de fechamento

A validação integrada passou na execução 35504735135: 76 testes locais e 52 de
52 cenários com PostgreSQL, Redis e Mailpit reais aprovados. O teste cobre
cadastro email-first, vínculo público restrito, convites, gestão exclusiva do
Mestre, MFA/fator fresco, concorrência de revisão, revogação entre instâncias,
bloqueio/reativação e isolamento da administração TTS. As correções equivalentes
estão na `main` nos commits `e1f972e06f2203816caa28a661a70077497ec626`
e `ebca1d4c4bc401660ef7231701f7c0ee5d01e486`.

A revisão nativa passou na execução 35504932472: os quatro Android (Cidadão,
Turista, Guarda/SEMUS e Fiscal TTS) compilaram, foram instalados e abertos nos
emuladores; a validação iOS também concluiu com sucesso. A execução foi feita
em branch isolada contendo somente os ajustes validados e infraestrutura
temporária de CI. Evidência resumida: `docs/evidence/block4-account-management-20260920.json`.

## Escopo entregue no código

- Cidadão e Turista: solicitar código por email, ativar conta com nome e senha
  próprios, entrar e vincular município ativo ao perfil público do app.
- Guarda/SEMUS, Fiscal TTS e administradores: ativar convite; somente o Mestre
  concede perfis internos. Um cadastro público nunca concede esses privilégios.
- Mestre: `/paineis/mestre/contas`, protegido no servidor e no backend. Criar
  município, convidar nova conta, revisar perfis por município, bloquear ou
  reativar conta. A listagem é paginada, com botões para carregar mais.
- Não existe criação, promoção, edição ou remoção de outro Mestre pela API.
  O provisionamento inicial permanece no comando local protegido do bloco 1.
- TTS administrativo é permissão própria dentro do Turismo; não equivale a
  Fiscal TTS nem concede automaticamente as demais áreas do Turismo.

## Proteções e decisões

O cadastro primeiro comprova o email. Antes disso, a conta tem senha aleatória
desconhecida e o login é bloqueado. Somente quem possui o código define a senha;
isso evita que um terceiro deixe uma senha conhecida usando o email de outra
pessoa. O código tem 30 minutos, finalidade e versão de credencial vinculadas;
é armazenado como hash, entregue em fila criptografada e consumido uma vez.
Solicitar cadastro de email existente não troca senha, nome ou privilégios.
Respostas de solicitação são genéricas e há limites compartilhados no Redis.

Toda escrita de gestão exige sessão Mestre pronta, senha atual e fator fresco
(autenticador ou código de recuperação de uso único). Mudanças exigem revisão
atual da conta e bloqueio transacional: uma edição concorrente recebe conflito,
sem sobrescrever silenciosamente outra. Recarregue as listas após conflito ou
falha de conexão antes de confirmar de novo; a interface não repete escritas
automaticamente. Senhas e fatores não ficam persistidos na tela.

Alterar perfis substitui o conjunto apenas no município escolhido, preserva
os outros municípios e revoga todas as sessões da conta. Perfis removidos ficam
inativos: autocadastro não desfaz a suspensão desse mesmo perfil. Bloqueio global
impede login; reativação preserva vínculos e MFA. Não há exclusão de contas.
Contas pendentes recebem novo código ao revisar seu vínculo; o antigo é invalidado.

A migração aditiva `003-account-management.sql` não altera os checksums das
migrações anteriores. A API continua sem CRUD direto de municípios/perfis e sem
direito de alterar `platform_admin`. Funções SQL de finalidade restrita verificam
a sessão, usam caminho de busca fixo e não têm execução liberada ao PUBLIC.
O contexto RLS isolado não é prova de autorização administrativa. Auditoria
registra ator, alvo, município e evento; não inclui senhas, códigos ou tokens.

## Fluxo validado no ambiente de desenvolvimento

1. Iniciar a infraestrutura de desenvolvimento e aplicar `npm run identity:migrate`.
2. Entrar como Mestre provisionado, confirmar email e MFA do fluxo existente.
3. Abrir Admin Mestre → Gerenciar contas e municípios e cadastrar o município.
4. Convidar email fictício, escolher município e perfis e confirmar senha/fator.
5. Na caixa local Mailpit, obter o código do convite. No app correspondente ou
   em `/entrar`, abrir ativação, informar código, nome e senha próprios.
6. Para Cidadão/Turista, usar Criar minha conta e, após entrar, Vincular município.
7. Conferir o acesso e, pelo Mestre, testar retirada de perfil e bloqueio global.

Os emails só chegam à caixa local de teste. Nenhum provedor externo foi
contratado/configurado. Não usar dados pessoais reais. Não é necessário que o
usuário execute comandos sem acompanhamento.

## Validação e limites

Antes do CI: tipos, 76 testes locais, build Next, rotas HTTP protegidas e oito
bundles JavaScript Android/iOS aprovados. Foram acrescentados cenários de banco
real para ativação/replay/expiração, isolamento, convites, revisão concorrente,
revogação em duas instâncias, MFA e BFF sem exposição do Bearer.

Os cenários com PostgreSQL/Redis/Mailpit reais e a nova revisão nativa foram
executados e aprovados nas execuções registradas acima. Isso fecha este bloco no
escopo técnico de desenvolvimento. Teste de interação ponta a ponta acompanhado
e homologação em celulares reais continuam necessários; os aparelhos físicos
foram deixados para a etapa seguinte.
Este bloco não implementa ainda operações municipais (ocorrências, turismo,
fiscalização), implantação pública, email real, integração oficial TTS,
documentação jurídica/LGPD formal ou publicação nas lojas.
