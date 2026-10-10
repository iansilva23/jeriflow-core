-- JeriFlow: RASCUNHO de tarifa para estudo, nunca tarifa oficial.
-- Não cria cobrança, débito, saldo, receipt, quitação, voucher, TTS nem acesso ao estacionamento.
CREATE TABLE app.parking_tariff_drafts (
 municipality_id uuid PRIMARY KEY REFERENCES app.municipalities(id),
 daily_rate_cents integer NOT NULL CHECK (daily_rate_cents BETWEEN 1 AND 1000000),
 currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency='BRL'),
 approval_state text NOT NULL DEFAULT 'draft' CHECK (approval_state='draft'),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>=1),
 rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 15 AND 500),
 updated_by uuid NOT NULL REFERENCES app.identity_users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.parking_tariff_draft_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
 client_request_id uuid NOT NULL,
 trace_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>=1),
 daily_rate_cents integer NOT NULL CHECK(daily_rate_cents BETWEEN 1 AND 1000000),
 rationale text NOT NULL CHECK(char_length(rationale) BETWEEN 15 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (municipality_id,client_request_id),
 UNIQUE (municipality_id,revision)
);
CREATE INDEX parking_tariff_draft_events_municipality
 ON app.parking_tariff_draft_events(municipality_id,revision);
REVOKE ALL ON app.parking_tariff_drafts,app.parking_tariff_draft_events
 FROM PUBLIC,jeriflow_app,jeriflow_scanner;

CREATE FUNCTION app.parking_tariff_draft_mutate(p_session text,p_data jsonb,p_trace uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; mid uuid; req uuid; expected integer; rate integer; note text;
 current_draft app.parking_tariff_drafts; replay app.parking_tariff_draft_events;
 next_revision integer;
BEGIN
 actor:=app.account_actor(p_session,false);
 mid:=(p_data->>'municipalityId')::uuid;
 req:=(p_data->>'clientRequestId')::uuid;
 expected:=(p_data->>'revision')::integer;
 rate:=(p_data->>'dailyRateCents')::integer;
 note:=p_data->>'rationale';
 IF mid IS NULL OR req IS NULL OR expected IS NULL OR expected<0
  OR rate IS NULL OR rate NOT BETWEEN 1 AND 1000000
  OR note IS NULL OR char_length(note) NOT BETWEEN 15 AND 500
  THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
 -- Lock municipal para serializar inclusive a primeira criação do rascunho.
 PERFORM 1 FROM app.municipalities WHERE id=mid AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor
   AND municipality_id=mid AND role_code='admin-turismo' AND active) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
 SELECT * INTO replay FROM app.parking_tariff_draft_events
  WHERE municipality_id=mid AND client_request_id=req;
 SELECT * INTO current_draft FROM app.parking_tariff_drafts WHERE municipality_id=mid;
 IF replay.id IS NOT NULL THEN
  IF replay.actor_user_id<>actor OR replay.daily_rate_cents<>rate
    OR replay.rationale<>note THEN
    RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005'; END IF;
  RETURN jsonb_build_object('municipalityId',mid,'approvalState','draft',
    'revision',current_draft.revision,'dailyRateCents',current_draft.daily_rate_cents,
    'currency','BRL','idempotent',true,'payable',false,'paymentRegistered',false,
    'authorizationIssued',false,'debtCreated',false);
 END IF;
 IF (current_draft.municipality_id IS NULL AND expected<>0)
   OR (current_draft.municipality_id IS NOT NULL
      AND current_draft.revision<>expected) THEN
    RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005'; END IF;
 next_revision:=expected+1;
 INSERT INTO app.parking_tariff_drafts
  (municipality_id,daily_rate_cents,rationale,revision,updated_by)
 VALUES(mid,rate,note,next_revision,actor)
 ON CONFLICT (municipality_id) DO UPDATE
  SET daily_rate_cents=EXCLUDED.daily_rate_cents,
      rationale=EXCLUDED.rationale,revision=EXCLUDED.revision,
      updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
 INSERT INTO app.parking_tariff_draft_events
  (municipality_id,actor_user_id,client_request_id,trace_id,revision,daily_rate_cents,rationale)
 VALUES(mid,actor,req,p_trace,next_revision,rate,note);
 RETURN jsonb_build_object('municipalityId',mid,'approvalState','draft',
   'revision',next_revision,'dailyRateCents',rate,'currency','BRL',
   'idempotent',false,'payable',false,'paymentRegistered',false,
   'authorizationIssued',false,'debtCreated',false);
END $$;

CREATE FUNCTION app.parking_tariff_draft_query(p_session text,p_mid uuid,p_entry_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; draft app.parking_tariff_drafts; entry app.parking_entry_drafts;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active) THEN
   RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor
    AND municipality_id=p_mid AND role_code='admin-turismo' AND active) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
 SELECT * INTO draft FROM app.parking_tariff_drafts WHERE municipality_id=p_mid;
 IF p_entry_id IS NOT NULL THEN
  SELECT * INTO entry FROM app.parking_entry_drafts
   WHERE id=p_entry_id AND municipality_id=p_mid;
  IF entry.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 END IF;
 RETURN jsonb_build_object(
  'draft',CASE WHEN draft.municipality_id IS NULL THEN NULL ELSE
    jsonb_build_object('approvalState','draft','dailyRateCents',draft.daily_rate_cents,
      'currency','BRL','revision',draft.revision,'rationale',draft.rationale,
      'updatedAt',draft.updated_at) END,
  'simulation',CASE WHEN entry.id IS NULL THEN NULL ELSE
    jsonb_build_object('entryId',entry.id,'plannedDays',entry.planned_days,
      'plannedUntil',entry.entry_at+(entry.planned_days*INTERVAL '24 hours'),
      'hypotheticalTotalCents',CASE WHEN draft.municipality_id IS NULL THEN NULL
       ELSE (entry.planned_days::bigint*draft.daily_rate_cents::bigint) END) END,
  'simulationOnly',true,'payable',false,'paymentRegistered',false,
  'authorizationIssued',false,'voucherIssued',false,'debtCreated',false);
END $$;

CREATE FUNCTION app.parking_tariff_draft_history(p_session text,p_mid uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active) THEN
   RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor
   AND municipality_id=p_mid AND role_code='admin-turismo' AND active) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
 RETURN jsonb_build_object('items',(
  SELECT coalesce(jsonb_agg(jsonb_build_object('revision',e.revision,
    'dailyRateCents',e.daily_rate_cents,'createdAt',e.created_at)
    ORDER BY e.revision),'[]'::jsonb)
  FROM app.parking_tariff_draft_events e WHERE e.municipality_id=p_mid
 ));
END $$;
REVOKE ALL ON FUNCTION app.parking_tariff_draft_mutate(text,jsonb,uuid),
 app.parking_tariff_draft_query(text,uuid,uuid),
 app.parking_tariff_draft_history(text,uuid)
 FROM PUBLIC,jeriflow_scanner;
GRANT EXECUTE ON FUNCTION app.parking_tariff_draft_mutate(text,jsonb,uuid),
 app.parking_tariff_draft_query(text,uuid,uuid),
 app.parking_tariff_draft_history(text,uuid)
 TO jeriflow_app;
