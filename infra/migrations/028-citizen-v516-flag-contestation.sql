-- JeriFlow V5.16 — Fase 33: direito de contestar sinalização da Guarda.
-- Referência original do ZIP SHA256:
-- 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- shared/jeriflow-audit-citizen.js openCitizenContest/sendCitizenContest:
-- min 10 caracteres e status ENVIADA, somente o próprio titular.
-- shared/jeriflow-audit-admin-semus.js e admin-cidadao.js:
-- ACOLHIDA / NÃO ACOLHIDA, justificativa min 5 caracteres.
-- Não criar bloqueio, sanção, notificação ou status de protocolo.
-- VISITANTE sem identidade autenticada confiável continua bloqueado.
CREATE TABLE app.citizen_v516_flag_contestations (
  protocol_id text PRIMARY KEY
    REFERENCES app.guard_v516_citizen_flags(protocol_id) ON DELETE RESTRICT,
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
  citizen_account_id uuid NOT NULL REFERENCES app.citizen_v516_accounts(id)
    ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  statement text NOT NULL CHECK(char_length(statement) BETWEEN 10 AND 2000),
  status text NOT NULL DEFAULT 'ENVIADA'
    CHECK(status IN ('ENVIADA','ACOLHIDA','NÃO ACOLHIDA')),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decision_note text CHECK(char_length(decision_note) BETWEEN 5 AND 2000),
  reviewed_by uuid REFERENCES app.identity_users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_request_id uuid UNIQUE,
  CHECK(
    (status='ENVIADA' AND reviewed_by IS NULL
      AND reviewed_at IS NULL AND review_request_id IS NULL
      AND decision_note IS NULL)
    OR
    (status IN ('ACOLHIDA','NÃO ACOLHIDA') AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL AND review_request_id IS NOT NULL
      AND decision_note IS NOT NULL)
  )
);
CREATE INDEX citizen_v516_flag_contestations_mid_idx
  ON app.citizen_v516_flag_contestations(municipality_id,submitted_at);

CREATE FUNCTION app.citizen_v516_flag_contestant(
  p_mid uuid,p_session_hash text,p_protocol text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE v_citizen_id text; account_id uuid;
BEGIN
  IF p_mid IS NULL OR p_session_hash IS NULL
     OR p_session_hash !~ '^[a-f0-9]{64}$'
     OR p_protocol IS NULL
     OR p_protocol !~ '^JF-[0-9]{8}-[0-9]{6,}$'
  THEN RAISE EXCEPTION 'INVALID_CITIZEN_SESSION' USING ERRCODE='JF003'; END IF;
  SELECT "citizenId" INTO v_citizen_id
    FROM app.citizen_v516_resolve(p_mid,p_session_hash);
  IF v_citizen_id IS NULL THEN
    RAISE EXCEPTION 'CITIZEN_SESSION_REQUIRED' USING ERRCODE='JF003';
  END IF;
  SELECT a.id INTO account_id FROM app.citizen_v516_accounts a
    JOIN app.citizen_v516_traffic_protocols p
      ON p.citizen_account_id=a.id AND p.municipality_id=a.municipality_id
    WHERE a.citizen_id=v_citizen_id
      AND a.municipality_id=p_mid
      AND p.municipality_id=p_mid AND p.id=p_protocol;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITIZEN_OWNERSHIP_REQUIRED' USING ERRCODE='JF003';
  END IF;
  RETURN account_id;
END $$;

CREATE FUNCTION app.citizen_v516_flag_contest_submit(
  p_mid uuid,p_session_hash text,p_protocol text,p_request uuid,p_statement text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE account_id uuid; cleaned text;
  existing app.citizen_v516_flag_contestations%ROWTYPE;
BEGIN
  account_id:=app.citizen_v516_flag_contestant(p_mid,p_session_hash,p_protocol);
  cleaned:=trim(coalesce(p_statement,''));
  IF p_request IS NULL OR char_length(cleaned) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'INVALID_CITIZEN_CONTEST' USING ERRCODE='JF001';
  END IF;
  -- Serializa envio repetido e evita alterar a sinalização durante a escrita.
  PERFORM 1 FROM app.guard_v516_citizen_flags f
    WHERE f.municipality_id=p_mid AND f.protocol_id=p_protocol
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FLAG_NOT_FOUND' USING ERRCODE='JF004';
  END IF;
  SELECT * INTO existing FROM app.citizen_v516_flag_contestations
    WHERE protocol_id=p_protocol;
  IF FOUND THEN
    IF existing.request_id=p_request
      AND existing.citizen_account_id=account_id
      AND existing.statement=cleaned THEN
      RETURN jsonb_build_object('protocolId',p_protocol,
        'status',existing.status,'alreadyProcessed',true);
    END IF;
    RAISE EXCEPTION 'CONTEST_ALREADY_SUBMITTED' USING ERRCODE='JF005';
  END IF;
  IF EXISTS(SELECT 1 FROM app.citizen_v516_flag_contestations
            WHERE request_id=p_request) THEN
    RAISE EXCEPTION 'CONTEST_REQUEST_CONFLICT' USING ERRCODE='JF005';
  END IF;
  INSERT INTO app.citizen_v516_flag_contestations(
    protocol_id,municipality_id,citizen_account_id,request_id,statement)
  VALUES(p_protocol,p_mid,account_id,p_request,cleaned);
  RETURN jsonb_build_object('protocolId',p_protocol,
    'status','ENVIADA','alreadyProcessed',false);
END $$;

CREATE FUNCTION app.citizen_v516_flag_contest_mine(
  p_mid uuid,p_session_hash text,p_protocol text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE account_id uuid; item jsonb;
BEGIN
  account_id:=app.citizen_v516_flag_contestant(p_mid,p_session_hash,p_protocol);
  SELECT jsonb_build_object(
     'protocolId',p_protocol,'flagStatus',f.flag_status,
     'reason',f.reason,'reviewStatus',f.review_status,
     'contestationStatus',c.status,'text',c.statement,
     'submittedAt',c.submitted_at,'reviewedAt',c.reviewed_at,
     'decisionNote',c.decision_note
  ) INTO item
  FROM app.guard_v516_citizen_flags f
  LEFT JOIN app.citizen_v516_flag_contestations c
    ON c.protocol_id=f.protocol_id AND c.citizen_account_id=account_id
  WHERE f.protocol_id=p_protocol AND f.municipality_id=p_mid;
  IF NOT FOUND THEN RETURN jsonb_build_object('available',false); END IF;
  RETURN item || jsonb_build_object('available',true);
END $$;

CREATE FUNCTION app.citizen_v516_contest_admin_actor(
  p_mid uuid,p_session_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  IF p_mid IS NULL OR p_session_hash IS NULL
     OR p_session_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_CONTEST_ADMIN' USING ERRCODE='JF003';
  END IF;
  actor:=app.account_actor(p_session_hash,false);
  PERFORM 1 FROM app.memberships m
    JOIN app.municipalities city
      ON city.id=m.municipality_id AND city.active
    WHERE m.user_id=actor AND m.municipality_id=p_mid AND m.active
      AND m.role_code IN ('admin-semus','admin-cidadao');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTEST_ADMIN_REQUIRED' USING ERRCODE='JF003';
  END IF;
  RETURN actor;
END $$;

CREATE FUNCTION app.citizen_v516_contest_admin_queue(
  p_mid uuid,p_session_hash text,p_after text,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; items jsonb;
BEGIN
  actor:=app.citizen_v516_contest_admin_actor(p_mid,p_session_hash);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
     OR (p_after IS NOT NULL AND
         p_after !~ '^JF-[0-9]{8}-[0-9]{6,}$') THEN
    RAISE EXCEPTION 'INVALID_CONTEST_QUERY' USING ERRCODE='JF001';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r."protocolId"),'[]'::jsonb)
  INTO items FROM (
    SELECT c.protocol_id AS "protocolId",c.status,c.statement AS "text",
      c.submitted_at AS "submittedAt",
      c.decision_note AS "decisionNote",
      c.reviewed_at AS "reviewedAt"
    FROM app.citizen_v516_flag_contestations c
    WHERE c.municipality_id=p_mid
      AND (p_after IS NULL OR c.protocol_id>p_after)
    ORDER BY c.protocol_id LIMIT p_limit
  ) r;
  RETURN jsonb_build_object('items',items);
END $$;

CREATE FUNCTION app.citizen_v516_contest_admin_review(
  p_mid uuid,p_session_hash text,p_protocol text,p_request uuid,
  p_decision text,p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; rec app.citizen_v516_flag_contestations%ROWTYPE;
  cleaned text;
BEGIN
  actor:=app.citizen_v516_contest_admin_actor(p_mid,p_session_hash);
  cleaned:=trim(coalesce(p_note,''));
  IF p_request IS NULL OR p_protocol IS NULL
    OR p_protocol !~ '^JF-[0-9]{8}-[0-9]{6,}$'
    OR p_decision IS NULL OR p_decision NOT IN ('ACOLHIDA','NÃO ACOLHIDA')
    OR char_length(cleaned) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'INVALID_CONTEST_DECISION' USING ERRCODE='JF001';
  END IF;
  SELECT * INTO rec FROM app.citizen_v516_flag_contestations
    WHERE municipality_id=p_mid AND protocol_id=p_protocol FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTEST_NOT_FOUND' USING ERRCODE='JF004';
  END IF;
  IF rec.status<>'ENVIADA' THEN
    IF rec.review_request_id=p_request AND rec.reviewed_by=actor
      AND rec.status=p_decision AND rec.decision_note=cleaned THEN
      RETURN jsonb_build_object('protocolId',p_protocol,
        'status',rec.status,'alreadyProcessed',true);
    END IF;
    RAISE EXCEPTION 'CONTEST_ALREADY_REVIEWED' USING ERRCODE='JF005';
  END IF;
  IF EXISTS(SELECT 1 FROM app.citizen_v516_flag_contestations
            WHERE review_request_id=p_request) THEN
    RAISE EXCEPTION 'CONTEST_REVIEW_CONFLICT' USING ERRCODE='JF005';
  END IF;
  UPDATE app.citizen_v516_flag_contestations
    SET status=p_decision,reviewed_at=clock_timestamp(),
        reviewed_by=actor,review_request_id=p_request,
        decision_note=cleaned
    WHERE municipality_id=p_mid AND protocol_id=p_protocol;
  RETURN jsonb_build_object('protocolId',p_protocol,
    'status',p_decision,'alreadyProcessed',false);
END $$;

REVOKE ALL ON app.citizen_v516_flag_contestations
  FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker,jeriflow_v516_reconciler;
REVOKE ALL ON FUNCTION
  app.citizen_v516_flag_contestant(uuid,text,text),
  app.citizen_v516_flag_contest_submit(uuid,text,text,uuid,text),
  app.citizen_v516_flag_contest_mine(uuid,text,text),
  app.citizen_v516_contest_admin_actor(uuid,text),
  app.citizen_v516_contest_admin_queue(uuid,text,text,integer),
  app.citizen_v516_contest_admin_review(uuid,text,text,uuid,text,text)
  FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker,jeriflow_v516_reconciler;
GRANT EXECUTE ON FUNCTION
  app.citizen_v516_flag_contest_submit(uuid,text,text,uuid,text),
  app.citizen_v516_flag_contest_mine(uuid,text,text),
  app.citizen_v516_contest_admin_queue(uuid,text,text,integer),
  app.citizen_v516_contest_admin_review(uuid,text,text,uuid,text,text)
  TO jeriflow_app;
