-- JeriFlow V5.16 — fila SOMENTE LEITURA para Guarda / ADM SEMUS.
-- V5.16 original ZIP: SHA-256
-- 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- guarda-semus/index.html renderQueues(), openDetail(), openService();
-- admin-semus/index.html. NÃO criar segundo protocolo nem novos status.
-- Esta migração NÃO adiciona tabela, UPDATE, DELETE nem direito sobre mídias.
-- Base: citizen_v516_traffic_protocols da migração 005 e identidade da 001–003.

CREATE FUNCTION app.citizen_v516_guard_actor(
  p_mid uuid,p_session_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  IF p_mid IS NULL OR p_session_hash IS NULL
    OR p_session_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_GUARD_SESSION' USING ERRCODE='JF003';
  END IF;
  actor:=app.account_actor(p_session_hash,false);
  PERFORM 1 FROM app.memberships membership
    JOIN app.municipalities city
      ON city.id=membership.municipality_id AND city.active
    WHERE membership.user_id=actor
      AND membership.municipality_id=p_mid
      AND membership.active
      AND membership.role_code IN ('guarda','admin-semus');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GUARD_ROLE_DENIED' USING ERRCODE='JF003';
  END IF;
  RETURN actor;
END $$;

-- "NEW", "IN_SERVICE", "FINISHED" são filtros privados da API,
-- NÃO novos estados da V5.16. Filas vêm de uma ÚNICA tabela de protocolo.
CREATE FUNCTION app.citizen_v516_guard_queue(
  p_mid uuid,p_session_hash text,p_filter text,p_after text,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM app.citizen_v516_guard_actor(p_mid,p_session_hash);
  IF p_filter IS NULL OR p_filter NOT IN ('NEW','IN_SERVICE','FINISHED','ALL')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR (p_after IS NOT NULL AND p_after !~ '^JF-[0-9]{8}-[0-9]{6,}$') THEN
    RAISE EXCEPTION 'INVALID_GUARD_QUERY' USING ERRCODE='JF001';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q."protocolId"),'[]'::jsonb)
  INTO result FROM (
    SELECT p.id AS "protocolId",p.title,p.location,p.plate,p.description,
      p.category,p.destination,p.status,p.has_photo AS "hasPhoto",
      p.created_at AS "createdAt",p.updated_at AS "updatedAt"
    FROM app.citizen_v516_traffic_protocols p
    WHERE p.municipality_id=p_mid
      AND (p_after IS NULL OR p.id>p_after)
      AND (
        p_filter='ALL'
        OR (p_filter='NEW' AND p.status='RECEBIDA')
        OR (p_filter='IN_SERVICE' AND p.status='EM ATENDIMENTO')
        OR (p_filter='FINISHED' AND p.status='FINALIZADA')
      )
    ORDER BY p.id LIMIT p_limit
  ) q;
  RETURN jsonb_build_object('items',result);
END $$;

-- Apenas tela de detalhe após autenticar GUARDA/SEMUS: nome e telefone
-- são dados pessoais necessários ao atendimento; não retornam em listagem.
-- Sem URL da foto: ela continua em armazenamento PRIVADO.
CREATE FUNCTION app.citizen_v516_guard_detail(
  p_mid uuid,p_session_hash text,p_protocol_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM app.citizen_v516_guard_actor(p_mid,p_session_hash);
  IF p_protocol_id IS NULL
    OR p_protocol_id !~ '^JF-[0-9]{8}-[0-9]{6,}$' THEN
    RAISE EXCEPTION 'INVALID_GUARD_QUERY' USING ERRCODE='JF001';
  END IF;
  SELECT jsonb_build_object(
    'protocolId',p.id,
    'title',p.title,'location',p.location,'plate',p.plate,
    'description',p.description,'category',p.category,
    'destination',p.destination,'status',p.status,
    'hasPhoto',p.has_photo,'createdAt',p.created_at,
    'updatedAt',p.updated_at,
    'reporter',jsonb_build_object(
      'name',p.identity_name,'phone',p.identity_phone,
      'citizenId',coalesce(a.citizen_id,'VISITANTE')
    )
  ) INTO result
  FROM app.citizen_v516_traffic_protocols p
  LEFT JOIN app.citizen_v516_accounts a
    ON a.id=p.citizen_account_id AND a.municipality_id=p.municipality_id
  WHERE p.municipality_id=p_mid AND p.id=p_protocol_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GUARD_PROTOCOL_NOT_FOUND' USING ERRCODE='JF004';
  END IF;
  RETURN result;
END $$;

-- Apenas execução de funções estreitas. PII, fotos e tabela canônica
-- continuam sem SELECT direto concedido ao usuário da API.
REVOKE ALL ON FUNCTION
  app.citizen_v516_guard_actor(uuid,text),
  app.citizen_v516_guard_queue(uuid,text,text,text,integer),
  app.citizen_v516_guard_detail(uuid,text,text)
  FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker,jeriflow_v516_reconciler;
GRANT EXECUTE ON FUNCTION
  app.citizen_v516_guard_queue(uuid,text,text,text,integer),
  app.citizen_v516_guard_detail(uuid,text,text)
  TO jeriflow_app;
