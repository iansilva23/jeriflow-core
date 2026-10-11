-- JeriFlow V5.16 — Fase 31: pedido de apoio à central da Guarda.
-- Fonte original: ZIP SHA-256
-- 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- guarda-semus/index.html #supportModal/#supportSend;
-- shared/jeriflow-audit-guarda.js #supportReason/#supportNote.
-- NÃO criar novo status da denúncia, tabela de protocolo, canal de chat ou
-- alegar notificação entregue sem integrador da central. Migrações 001–025 intocadas.

CREATE TABLE app.guard_v516_support_requests (
  request_id uuid PRIMARY KEY,
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
  protocol_id text NOT NULL REFERENCES app.citizen_v516_traffic_protocols(id)
    ON DELETE RESTRICT,
  guard_user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(reason IN (
    'Necessidade de outro agente','Via bloqueada','Conflito no local','Outro')),
  note text NOT NULL DEFAULT '' CHECK(char_length(note)<=2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX guard_v516_support_mid_idx
  ON app.guard_v516_support_requests(municipality_id,request_id);

-- Pedido criado pelo próprio guarda. O HTML permite suporte para uma denúncia
-- RECEBIDA ou EM ATENDIMENTO; uma FINALIZADA não abre esse botão.
CREATE FUNCTION app.guard_v516_support_submit(
  p_mid uuid,p_session_hash text,p_protocol text,p_request uuid,
  p_reason text,p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; old app.guard_v516_support_requests%ROWTYPE;
  protocol_status text;
BEGIN
  actor:=app.guard_v516_field_actor(p_mid,p_session_hash);
  IF p_request IS NULL OR p_protocol IS NULL
     OR p_protocol !~ '^JF-[0-9]{8}-[0-9]{6,}$'
     OR p_reason IS NULL OR p_reason NOT IN (
       'Necessidade de outro agente','Via bloqueada',
       'Conflito no local','Outro')
     OR p_note IS NULL OR char_length(trim(p_note))>2000 THEN
    RAISE EXCEPTION 'INVALID_SUPPORT_REQUEST' USING ERRCODE='JF001';
  END IF;

  -- Resolve primeiro o replay para recuperar ACK perdido depois do COMMIT.
  SELECT * INTO old FROM app.guard_v516_support_requests
    WHERE request_id=p_request;
  IF FOUND THEN
    IF old.guard_user_id<>actor OR old.municipality_id<>p_mid OR
       old.protocol_id<>p_protocol OR old.reason<>p_reason OR
       old.note<>trim(p_note) THEN
      RAISE EXCEPTION 'SUPPORT_REQUEST_CONFLICT' USING ERRCODE='JF005';
    END IF;
    RETURN jsonb_build_object('requestId',p_request,
      'protocolId',p_protocol,'recorded',true,'alreadyProcessed',true);
  END IF;

  SELECT status INTO protocol_status
    FROM app.citizen_v516_traffic_protocols
    WHERE id=p_protocol AND municipality_id=p_mid FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GUARD_PROTOCOL_NOT_FOUND' USING ERRCODE='JF004';
  END IF;
  IF protocol_status NOT IN ('RECEBIDA','EM ATENDIMENTO') THEN
    RAISE EXCEPTION 'GUARD_SUPPORT_CLOSED' USING ERRCODE='JF005';
  END IF;

  INSERT INTO app.guard_v516_support_requests(
     request_id,municipality_id,protocol_id,guard_user_id,reason,note)
   VALUES(p_request,p_mid,p_protocol,actor,p_reason,trim(p_note))
   ON CONFLICT (request_id) DO NOTHING;
  IF NOT FOUND THEN
    -- Corrida entre duas conexões com MESMO UUID: vencer conflito não duplica.
    SELECT * INTO old FROM app.guard_v516_support_requests
      WHERE request_id=p_request;
    IF NOT FOUND OR old.guard_user_id<>actor OR old.municipality_id<>p_mid
       OR old.protocol_id<>p_protocol OR old.reason<>p_reason OR
       old.note<>trim(p_note) THEN
      RAISE EXCEPTION 'SUPPORT_REQUEST_CONFLICT' USING ERRCODE='JF005';
    END IF;
    RETURN jsonb_build_object('requestId',p_request,
      'protocolId',p_protocol,'recorded',true,'alreadyProcessed',true);
  END IF;
  RETURN jsonb_build_object('requestId',p_request,
    'protocolId',p_protocol,'recorded',true,'alreadyProcessed',false);
END $$;

-- Consulta para a administração SEMUS ver PEDIDOS REGISTRADOS,
-- jamais afirmar envio de notificação, despacho ou confirmação de leitura.
CREATE FUNCTION app.guard_v516_support_admin_queue(
  p_mid uuid,p_session_hash text,p_after uuid,p_limit integer
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
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'INVALID_SUPPORT_QUERY' USING ERRCODE='JF001';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r."requestId"),'[]'::jsonb)
  INTO items FROM (
    SELECT s.request_id AS "requestId",s.protocol_id AS "protocolId",
      s.reason,s.note,s.created_at AS "createdAt",
      guard.display_name AS "guardName"
    FROM app.guard_v516_support_requests s
      JOIN app.identity_users guard ON guard.id=s.guard_user_id
    WHERE s.municipality_id=p_mid
      AND (p_after IS NULL OR s.request_id>p_after)
    ORDER BY s.request_id LIMIT p_limit
  ) r;
  RETURN jsonb_build_object('items',items);
END $$;

REVOKE ALL ON app.guard_v516_support_requests
 FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker,jeriflow_v516_reconciler;
REVOKE ALL ON FUNCTION
 app.guard_v516_support_submit(uuid,text,text,uuid,text,text),
 app.guard_v516_support_admin_queue(uuid,text,uuid,integer)
 FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker,jeriflow_v516_reconciler;
GRANT EXECUTE ON FUNCTION
 app.guard_v516_support_submit(uuid,text,text,uuid,text,text),
 app.guard_v516_support_admin_queue(uuid,text,uuid,integer)
 TO jeriflow_app;
