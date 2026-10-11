-- JeriFlow V5.16 — Fase 32: sinalização de denunciante para ADM SEMUS.
-- ZIP original SHA256:
-- 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- guarda-semus/index.html #reportCitizenModal, #reportReason, #reportReasonNote;
-- shared/jeriflow-audit-guarda.js reportCitizenSend (min 10 caracteres).
-- admin-semus/index.html reviewFlag() = ARQUIVADA / ANALISADA.
-- SINALIZAR NÃO É PUNIR, BLOQUEAR OU ADVERTIR. Nenhuma sanção automática.
-- Não editar protocolos da migração 005, migrações 024–026 nem telas.
CREATE TABLE app.guard_v516_citizen_flags (
  protocol_id text PRIMARY KEY
    REFERENCES app.citizen_v516_traffic_protocols(id) ON DELETE RESTRICT,
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  guard_user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(reason IN (
    'Trote / denúncia falsa',
    'Informação deliberadamente incorreta',
    'Uso abusivo do canal','Reincidência','Outro')),
  note text NOT NULL CHECK(char_length(note) BETWEEN 10 AND 2000),
  flag_status text NOT NULL DEFAULT 'EM ANÁLISE'
    CHECK(flag_status='EM ANÁLISE'),
  review_status text NOT NULL DEFAULT 'PENDENTE'
    CHECK(review_status IN ('PENDENTE','ARQUIVADA','ANALISADA')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES app.identity_users(id) ON DELETE RESTRICT,
  review_request_id uuid UNIQUE,
  CHECK((review_status='PENDENTE' AND reviewed_at IS NULL AND
         reviewed_by IS NULL AND review_request_id IS NULL)
      OR (review_status IN ('ARQUIVADA','ANALISADA') AND reviewed_at IS NOT NULL
          AND reviewed_by IS NOT NULL AND review_request_id IS NOT NULL))
);
CREATE INDEX guard_v516_flags_mid_idx
  ON app.guard_v516_citizen_flags(municipality_id,created_at DESC);

-- Guarda reporta apenas caso assumido por ELA, ainda EM ATENDIMENTO.
-- Mutex no protocolo impede corrida com conclusão e com outra sinalização.
CREATE FUNCTION app.guard_v516_flag_submit(
  p_mid uuid,p_session_hash text,p_protocol text,p_request uuid,
  p_reason text,p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; p app.citizen_v516_traffic_protocols%ROWTYPE;
  existing app.guard_v516_citizen_flags%ROWTYPE;
  cleaned text;
BEGIN
  actor:=app.guard_v516_field_actor(p_mid,p_session_hash);
  cleaned:=trim(coalesce(p_note,''));
  IF p_request IS NULL OR p_protocol IS NULL
    OR p_protocol !~ '^JF-[0-9]{8}-[0-9]{6,}$'
    OR p_reason IS NULL OR p_reason NOT IN (
       'Trote / denúncia falsa','Informação deliberadamente incorreta',
       'Uso abusivo do canal','Reincidência','Outro')
    OR char_length(cleaned) NOT BETWEEN 10 AND 2000
  THEN
    RAISE EXCEPTION 'INVALID_FLAG_REQUEST' USING ERRCODE='JF001';
  END IF;
  SELECT * INTO p FROM app.citizen_v516_traffic_protocols
    WHERE id=p_protocol AND municipality_id=p_mid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GUARD_PROTOCOL_NOT_FOUND' USING ERRCODE='JF004';
  END IF;
  SELECT * INTO existing FROM app.guard_v516_citizen_flags
    WHERE protocol_id=p_protocol;
  IF FOUND THEN
    IF existing.request_id=p_request AND existing.guard_user_id=actor
      AND existing.reason=p_reason AND existing.note=cleaned THEN
      RETURN jsonb_build_object('protocolId',p_protocol,
        'status',existing.flag_status,
        'reviewStatus',existing.review_status,'alreadyProcessed',true);
    END IF;
    RAISE EXCEPTION 'FLAG_ALREADY_REPORTED' USING ERRCODE='JF005';
  END IF;
  IF p.status<>'EM ATENDIMENTO' OR NOT EXISTS(
      SELECT 1 FROM app.guard_v516_service_rounds s
      WHERE s.protocol_id=p_protocol AND s.municipality_id=p_mid
        AND s.guard_user_id=actor AND s.finished_at IS NULL
    ) THEN
    RAISE EXCEPTION 'FLAG_REQUIRES_ASSIGNED_GUARD' USING ERRCODE='JF003';
  END IF;
  -- Impede reutilizar request_id em outra denúncia.
  IF EXISTS(SELECT 1 FROM app.guard_v516_citizen_flags
            WHERE request_id=p_request) THEN
    RAISE EXCEPTION 'FLAG_REQUEST_CONFLICT' USING ERRCODE='JF005';
  END IF;
  INSERT INTO app.guard_v516_citizen_flags(
    protocol_id,municipality_id,request_id,guard_user_id,reason,note)
  VALUES(p_protocol,p_mid,p_request,actor,p_reason,cleaned);
  RETURN jsonb_build_object('protocolId',p_protocol,'status','EM ANÁLISE',
    'reviewStatus','PENDENTE','alreadyProcessed',false);
END $$;

-- ADM SEMUS pode consultar o reporte e decidir (não pode punir automaticamente).
CREATE FUNCTION app.guard_v516_flags_admin_queue(
  p_mid uuid,p_session_hash text,p_after text,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; items jsonb;
BEGIN
  actor:=app.citizen_v516_guard_actor(p_mid,p_session_hash);
  PERFORM 1 FROM app.memberships m
    WHERE m.user_id=actor AND m.municipality_id=p_mid
      AND m.active AND m.role_code='admin-semus';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_SEMUS_REQUIRED' USING ERRCODE='JF003';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR
    (p_after IS NOT NULL AND p_after !~ '^JF-[0-9]{8}-[0-9]{6,}$') THEN
    RAISE EXCEPTION 'INVALID_FLAG_QUERY' USING ERRCODE='JF001';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q."protocolId"),'[]'::jsonb)
  INTO items FROM (
    SELECT f.protocol_id AS "protocolId",p.identity_name AS "citizenName",
      f.reason,f.note,f.flag_status AS "status",
      f.review_status AS "reviewStatus",
      f.created_at AS "createdAt",f.reviewed_at AS "reviewedAt",
      g.display_name AS "guardName"
    FROM app.guard_v516_citizen_flags f
      JOIN app.citizen_v516_traffic_protocols p
        ON p.id=f.protocol_id AND p.municipality_id=f.municipality_id
      JOIN app.identity_users g ON g.id=f.guard_user_id
    WHERE f.municipality_id=p_mid
      AND (p_after IS NULL OR f.protocol_id>p_after)
    ORDER BY f.protocol_id LIMIT p_limit
  ) q;
  RETURN jsonb_build_object('items',items);
END $$;

-- Decisão EXATA do ADM original: ARQUIVADA ou ANALISADA.
-- Um status ANALISADA NÃO REPRESENTA BLOQUEIO, ADVERTÊNCIA OU PUNIÇÃO.
CREATE FUNCTION app.guard_v516_flag_review(
  p_mid uuid,p_session_hash text,p_protocol text,p_request uuid,
  p_decision text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; f app.guard_v516_citizen_flags%ROWTYPE;
BEGIN
  actor:=app.citizen_v516_guard_actor(p_mid,p_session_hash);
  PERFORM 1 FROM app.memberships m
    WHERE m.user_id=actor AND m.municipality_id=p_mid
      AND m.active AND m.role_code='admin-semus';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_SEMUS_REQUIRED' USING ERRCODE='JF003';
  END IF;
  IF p_request IS NULL OR p_protocol IS NULL
    OR p_protocol !~ '^JF-[0-9]{8}-[0-9]{6,}$'
    OR p_decision IS NULL OR p_decision NOT IN ('ARQUIVADA','ANALISADA') THEN
    RAISE EXCEPTION 'INVALID_FLAG_DECISION' USING ERRCODE='JF001';
  END IF;
  SELECT * INTO f FROM app.guard_v516_citizen_flags
    WHERE municipality_id=p_mid AND protocol_id=p_protocol FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FLAG_NOT_FOUND' USING ERRCODE='JF004';
  END IF;
  IF f.review_status<>'PENDENTE' THEN
    IF f.review_request_id=p_request AND
      f.reviewed_by=actor AND f.review_status=p_decision THEN
      RETURN jsonb_build_object('protocolId',p_protocol,
        'reviewStatus',f.review_status,'alreadyProcessed',true);
    END IF;
    RAISE EXCEPTION 'FLAG_ALREADY_REVIEWED' USING ERRCODE='JF005';
  END IF;
  IF EXISTS(SELECT 1 FROM app.guard_v516_citizen_flags
     WHERE review_request_id=p_request) THEN
    RAISE EXCEPTION 'FLAG_REVIEW_REQUEST_CONFLICT' USING ERRCODE='JF005';
  END IF;
  UPDATE app.guard_v516_citizen_flags
    SET review_status=p_decision,reviewed_at=clock_timestamp(),
        reviewed_by=actor,review_request_id=p_request
    WHERE municipality_id=p_mid AND protocol_id=p_protocol;
  RETURN jsonb_build_object('protocolId',p_protocol,
    'reviewStatus',p_decision,'alreadyProcessed',false);
END $$;

REVOKE ALL ON app.guard_v516_citizen_flags
  FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker,jeriflow_v516_reconciler;
REVOKE ALL ON FUNCTION
  app.guard_v516_flag_submit(uuid,text,text,uuid,text,text),
  app.guard_v516_flags_admin_queue(uuid,text,text,integer),
  app.guard_v516_flag_review(uuid,text,text,uuid,text)
  FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker,jeriflow_v516_reconciler;
GRANT EXECUTE ON FUNCTION
  app.guard_v516_flag_submit(uuid,text,text,uuid,text,text),
  app.guard_v516_flags_admin_queue(uuid,text,text,integer),
  app.guard_v516_flag_review(uuid,text,text,uuid,text)
  TO jeriflow_app;
