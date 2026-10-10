-- JeriFlow: inbox de eventos ARTIFICIAIS para treinar conciliação.
-- NÃO possui credenciais de PSP, webhook, pagamento, voucher, dívida ou prazo quitado.
CREATE TABLE app.parking_reconciliation_lab_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 created_by uuid NOT NULL REFERENCES app.identity_users(id),
 client_request_id uuid NOT NULL,
 order_key uuid NOT NULL,
 expected_cents integer NOT NULL CHECK (expected_cents BETWEEN 1 AND 90000000),
 currency char(3) NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 test_only boolean NOT NULL DEFAULT true CHECK(test_only),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (municipality_id,client_request_id),
 UNIQUE (municipality_id,order_key),
 UNIQUE (id,municipality_id)
);
CREATE TABLE app.parking_reconciliation_lab_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL,
 municipality_id uuid NOT NULL,
 recorded_by uuid NOT NULL REFERENCES app.identity_users(id),
 sample_event_id uuid NOT NULL,
 sample_reference text NOT NULL CHECK(sample_reference ~ '^TEST_[A-Z0-9_]{3,60}$'),
 sample_kind text NOT NULL CHECK(sample_kind IN ('sample_confirmation','sample_refund','sample_chargeback')),
 sample_amount_cents integer NOT NULL CHECK(sample_amount_cents BETWEEN 1 AND 90000000),
 currency char(3) NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 test_only boolean NOT NULL DEFAULT true CHECK(test_only),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (case_id,municipality_id) REFERENCES app.parking_reconciliation_lab_cases(id,municipality_id),
 UNIQUE (municipality_id,sample_event_id),
 UNIQUE (municipality_id,sample_reference)
);
CREATE INDEX parking_reconciliation_lab_events_case_idx
 ON app.parking_reconciliation_lab_events(case_id,recorded_at,id);
REVOKE ALL ON app.parking_reconciliation_lab_cases,
 app.parking_reconciliation_lab_events FROM PUBLIC,jeriflow_app,jeriflow_scanner;

CREATE FUNCTION app.parking_reconciliation_lab_mutate(p_session text,p_data jsonb,p_trace uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; mid uuid; op text; req uuid; cid uuid; event_key uuid;
 k text; amount integer; reference text; oid uuid;
 existing app.parking_reconciliation_lab_cases;
 record app.parking_reconciliation_lab_events;
 created boolean:=false;
BEGIN
 actor:=app.account_actor(p_session,false);
 mid:=(p_data->>'municipalityId')::uuid; op:=p_data->>'operation';
 IF mid IS NULL OR op IS NULL OR op NOT IN ('create_case','append_event') THEN
   RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=mid AND active) THEN
   RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor AND municipality_id=mid
   AND role_code='admin-turismo' AND active) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
 IF op='create_case' THEN
   req:=(p_data->>'clientRequestId')::uuid; oid:=(p_data->>'orderKey')::uuid;
   amount:=(p_data->>'expectedCents')::integer;
   IF req IS NULL OR oid IS NULL OR amount IS NULL OR amount NOT BETWEEN 1 AND 90000000 THEN
     RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
   -- Serializa até a criação, antes da existência da linha da amostra.
   PERFORM 1 FROM app.municipalities WHERE id=mid FOR UPDATE;
   SELECT * INTO existing FROM app.parking_reconciliation_lab_cases
     WHERE municipality_id=mid AND client_request_id=req;
   IF existing.id IS NULL THEN
     INSERT INTO app.parking_reconciliation_lab_cases
       (municipality_id,created_by,client_request_id,order_key,expected_cents)
       VALUES(mid,actor,req,oid,amount)
       RETURNING * INTO existing;
     created:=true;
   ELSIF existing.created_by<>actor OR existing.order_key<>oid
     OR existing.expected_cents<>amount THEN
     RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005';
   END IF;
   RETURN jsonb_build_object('caseId',existing.id,'created',created,
     'testOnly',true,'financialEffectsEnabled',false,
     'paymentRegistered',false,'authorizationIssued',false,'voucherIssued',false,
     'debtCreated',false,'paidUntil',NULL);
 END IF;
 cid:=(p_data->>'caseId')::uuid;event_key:=(p_data->>'sampleEventId')::uuid;
 reference:=p_data->>'sampleReference';k:=p_data->>'sampleKind';
 amount:=(p_data->>'sampleAmountCents')::integer;
 IF cid IS NULL OR event_key IS NULL OR reference IS NULL
  OR reference !~ '^TEST_[A-Z0-9_]{3,60}$'
  OR k IS NULL OR k NOT IN ('sample_confirmation','sample_refund','sample_chargeback')
  OR amount IS NULL OR amount NOT BETWEEN 1 AND 90000000 THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
  SELECT * INTO existing FROM app.parking_reconciliation_lab_cases
  WHERE id=cid AND municipality_id=mid FOR UPDATE;
 IF existing.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 SELECT * INTO record FROM app.parking_reconciliation_lab_events
  WHERE municipality_id=mid AND sample_event_id=event_key;
 IF record.id IS NOT NULL THEN
   IF record.case_id<>cid OR record.recorded_by<>actor OR
    record.sample_reference<>reference OR record.sample_kind<>k OR
    record.sample_amount_cents<>amount THEN
    RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005'; END IF;
 ELSE
  INSERT INTO app.parking_reconciliation_lab_events
   (case_id,municipality_id,recorded_by,sample_event_id,sample_reference,
    sample_kind,sample_amount_cents)
   VALUES(cid,mid,actor,event_key,reference,k,amount)
   RETURNING * INTO record;
  created:=true;
 END IF;
 RETURN jsonb_build_object('caseId',cid,'sampleEventId',event_key,'created',created,
  'testOnly',true,'financialEffectsEnabled',false,'paymentRegistered',false,
  'authorizationIssued',false,'voucherIssued',false,'debtCreated',false,'paidUntil',NULL);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005';
END $$;

CREATE FUNCTION app.parking_reconciliation_lab_query(p_session text,p_mid uuid,p_case uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; item app.parking_reconciliation_lab_cases;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active) THEN
   RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor AND municipality_id=p_mid
   AND active AND role_code='admin-turismo') THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
 SELECT * INTO item FROM app.parking_reconciliation_lab_cases
   WHERE id=p_case AND municipality_id=p_mid;
 IF item.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 RETURN jsonb_build_object(
  'caseId',item.id,'orderKey',item.order_key,'expectedCents',item.expected_cents,
  'currency','BRL','testOnly',true,'financialEffectsEnabled',false,
  'paymentRegistered',false,'authorizationIssued',false,'voucherIssued',false,
  'debtCreated',false,'paidUntil',NULL,'events',(
   SELECT coalesce(jsonb_agg(jsonb_build_object(
    'sampleEventId',e.sample_event_id,'sampleReference',e.sample_reference,
    'sampleKind',e.sample_kind,'sampleAmountCents',e.sample_amount_cents,
    'recordedAt',e.recorded_at) ORDER BY e.recorded_at,e.id),'[]'::jsonb)
   FROM app.parking_reconciliation_lab_events e
   WHERE e.case_id=item.id AND e.municipality_id=p_mid
  ));
END $$;
REVOKE ALL ON FUNCTION app.parking_reconciliation_lab_mutate(text,jsonb,uuid),
 app.parking_reconciliation_lab_query(text,uuid,uuid)
 FROM PUBLIC,jeriflow_scanner;
GRANT EXECUTE ON FUNCTION app.parking_reconciliation_lab_mutate(text,jsonb,uuid),
 app.parking_reconciliation_lab_query(text,uuid,uuid) TO jeriflow_app;
