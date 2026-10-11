-- JeriFlow V5.16 — Etapa 30: disponibilidade EM/FORA DE SERVIÇO da Guarda.
-- Fonte ORIGINAL revisada antes de escrever:
-- ZIP 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- guarda-semus/index.html: onShift=true; shiftBtn.onclick; publishGuardState();
-- shared/jeriflow-audit-guarda.js: restaura onShift=false salvo.
-- A V5.16 NÃO bloqueia acceptReport()/finishBtn pela disponibilidade.
-- NÃO adicionar esse bloqueio nem alterar a migração 024.
CREATE TABLE app.guard_v516_shift_presence (
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
  guard_user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE RESTRICT,
  on_shift boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(municipality_id,guard_user_id)
);
CREATE TABLE app.guard_v516_shift_events (
  request_id uuid PRIMARY KEY,
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
  guard_user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE RESTRICT,
  on_shift boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX guard_v516_shift_events_guard_idx
  ON app.guard_v516_shift_events(municipality_id,guard_user_id,created_at DESC);

-- Revalida perfil e sessão. Um agente sem marcação registrada começa
-- EM SERVIÇO, exatamente como a variável onShift=true do protótipo.
CREATE FUNCTION app.guard_v516_shift_get(
  p_mid uuid,p_session_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; presence app.guard_v516_shift_presence%ROWTYPE;
BEGIN
  actor:=app.guard_v516_field_actor(p_mid,p_session_hash);
  SELECT * INTO presence FROM app.guard_v516_shift_presence
    WHERE municipality_id=p_mid AND guard_user_id=actor;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('onShift',true,'updatedAt',NULL);
  END IF;
  RETURN jsonb_build_object(
    'onShift',presence.on_shift,'updatedAt',presence.updated_at);
END $$;

-- O botão envia o valor DESEJADO explicitamente, nunca "alternar" no SQL:
-- assim uma repetição por rede não inverte o estado duas vezes.
CREATE FUNCTION app.guard_v516_shift_set(
  p_mid uuid,p_session_hash text,p_request uuid,p_on_shift boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; previous app.guard_v516_shift_events%ROWTYPE;
 presence app.guard_v516_shift_presence%ROWTYPE;
BEGIN
  actor:=app.guard_v516_field_actor(p_mid,p_session_hash);
  IF p_request IS NULL OR p_on_shift IS NULL THEN
    RAISE EXCEPTION 'INVALID_SHIFT_CHANGE' USING ERRCODE='JF001';
  END IF;
  INSERT INTO app.guard_v516_shift_presence(municipality_id,guard_user_id,on_shift)
    VALUES(p_mid,actor,true)
    ON CONFLICT (municipality_id,guard_user_id) DO NOTHING;
  SELECT * INTO presence FROM app.guard_v516_shift_presence
    WHERE municipality_id=p_mid AND guard_user_id=actor FOR UPDATE;

  SELECT * INTO previous FROM app.guard_v516_shift_events
    WHERE request_id=p_request;
  IF FOUND THEN
    IF previous.municipality_id<>p_mid OR previous.guard_user_id<>actor
       OR previous.on_shift IS DISTINCT FROM p_on_shift THEN
      RAISE EXCEPTION 'SHIFT_REQUEST_CONFLICT' USING ERRCODE='JF005';
    END IF;
    -- Não repetir o evento nem reverter um estado que mudou depois.
    RETURN jsonb_build_object('onShift',presence.on_shift,
      'updatedAt',presence.updated_at,'alreadyProcessed',true);
  END IF;

  UPDATE app.guard_v516_shift_presence
    SET on_shift=p_on_shift,updated_at=clock_timestamp()
    WHERE municipality_id=p_mid AND guard_user_id=actor
    RETURNING * INTO presence;
  INSERT INTO app.guard_v516_shift_events(
      request_id,municipality_id,guard_user_id,on_shift)
    VALUES(p_request,p_mid,actor,p_on_shift);
  RETURN jsonb_build_object('onShift',presence.on_shift,
    'updatedAt',presence.updated_at,'alreadyProcessed',false);
END $$;

REVOKE ALL ON app.guard_v516_shift_presence,app.guard_v516_shift_events
  FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker,jeriflow_v516_reconciler;
REVOKE ALL ON FUNCTION
  app.guard_v516_shift_get(uuid,text),
  app.guard_v516_shift_set(uuid,text,uuid,boolean)
  FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker,jeriflow_v516_reconciler;
GRANT EXECUTE ON FUNCTION
  app.guard_v516_shift_get(uuid,text),
  app.guard_v516_shift_set(uuid,text,uuid,boolean)
  TO jeriflow_app;
