# Acesso do ADM da Ouvidoria — regra aprovada pelo titular do produto

Pessoas com acesso `admin-cidadao` ativo ao ADM da Ouvidoria podem visualizar e operar **todas as categorias**: denúncia, reclamação, solicitação e sugestão, inclusive histórico e metadados dos anexos, no município autorizado. Não esconder denúncias da fila administrativa. A migração 010 reforça essa regra sem reescrever o Bloco 4.

**Auditoria:** leituras da fila, histórico e metadados de anexos ficam registradas em tabela privada com ator, município, protocolo quando aplicável, ação e data; não duplicar textos ou documentos privados. Operações de triagem/resposta/encerramento continuam auditadas nos eventos existentes.

**Limites de segurança continuam valendo:** autenticação, MFA, revogação de associação municipal, não exposição entre municípios e proteção de dados da LGPD. O acesso administrativo integral **não** dispensa os critérios de antivírus: bytes de anexos em quarentena ou não verificados permanecem indisponíveis para qualquer pessoa, inclusive o ADM. A leitura de bytes de teste continua bloqueada em produção.

Não liberar dados reais antes da política institucional, retenção, implantação isolada e testes em dispositivos.
