-- Primeiro ciclo de cadastro e saída operacional, exclusivo de homologação.
-- NÃO cria direito de estacionamento, voucher, diária, pagamento, TTS ou cobrança.
CREATE TABLE app.parking_entry_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
  created_by uuid NOT NULL REFERENCES app.identity_users(id),
  client_request_id uuid NOT NULL,
  vehicle_plate text NOT NULL CHECK (vehicle_plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  vehicle_brand text NOT NULL CHECK (char_length(vehicle_brand) BETWEEN 2 AND 60),
  vehicle_model text NOT NULL CHECK (char_length(vehicle_model) BETWEEN 2 AND 60),
  area_text text NOT NULL CHECK (char_length(area_text) BETWEEN 5 AND 120),
  lodging_name text CHECK (lodging_name IS NULL OR char_length(lodging_name) BETWEEN 3 AND 120),
  entry_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  departure_at timestamptz,
  status text NOT NULL DEFAULT 'present' CHECK (status IN ('present','departed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>=1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (municipality_id,created_by,client_request_id),
  CHECK ((status='present' AND departure_at IS NULL) OR
         (status='departed' AND departure_at IS NOT NULL AND departure_at>=entry_at))
);
CREATE UNIQUE INDEX parking_entry_drafts_active_plate
 ON app.parking_entry_drafts(municipality_id,vehicle_plate) WHERE status='present';
CREATE INDEX parking_entry_drafts_tenant
 ON app.parking_entry_drafts(municipality_id,id);
CREATE TABLE app.parking_entry_draft_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES app.parking_entry_drafts(id),
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
  actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
  trace_id uuid NOT NULL,
  code text NOT NULL CHECK (code IN ('entered','departed')),
  revision integer NOT NULL CHECK (revision>=1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (entry_id,revision)
);
CREATE INDEX parking_entry_draft_events_entry
 ON app.parking_entry_draft_events(entry_id,revision);
REVOKE ALL ON app.parking_entry_drafts,app.parking_entry_draft_events
 FROM PUBLIC,jeriflow_app,jeriflow_scanner;

CREATE FUNCTION app.parking_entry_draft_mutate(p_session text,p_data jsonb,p_trace uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; mid uuid; op text; record_id uuid; rec app.parking_entry_drafts;
BEGIN
 actor:=app.account_actor(p_session,false);
 mid:=(p_data->>'municipalityId')::uuid;
 op:=p_data->>'operation';
 IF mid IS NULL OR op IS NULL OR op NOT IN ('enter','depart') THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=mid AND active) THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor
  AND municipality_id=mid AND active AND role_code='admin-turismo') THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003';
 END IF;
 IF op='enter' THEN
  IF p_data->>'clientRequestId' IS NULL OR
     p_data->>'vehiclePlate' !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' OR
     char_length(p_data->>'vehicleBrand') NOT BETWEEN 2 AND 60 OR
     char_length(p_data->>'vehicleModel') NOT BETWEEN 2 AND 60 OR
     char_length(p_data->>'areaText') NOT BETWEEN 5 AND 120 OR
     (p_data->>'lodgingName' IS NOT NULL AND
      char_length(p_data->>'lodgingName') NOT BETWEEN 3 AND 120) THEN
   RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
  END IF;
  -- Repetições da mesma chave não criam uma segunda entrada.
  INSERT INTO app.parking_entry_drafts
    (municipality_id,created_by,client_request_id,vehicle_plate,vehicle_brand,
     vehicle_model,area_text,lodging_name)
  VALUES (mid,actor,(p_data->>'clientRequestId')::uuid,p_data->>'vehiclePlate',
     p_data->>'vehicleBrand',p_data->>'vehicleModel',p_data->>'areaText',
     p_data->>'lodgingName')
  ON CONFLICT (municipality_id,created_by,client_request_id) DO NOTHING
  RETURNING id INTO record_id;
  IF record_id IS NULL THEN
   SELECT * INTO rec FROM app.parking_entry_drafts WHERE municipality_id=mid
     AND created_by=actor AND client_request_id=(p_data->>'clientRequestId')::uuid;
   IF rec.id IS NULL OR rec.vehicle_plate<>p_data->>'vehiclePlate'
     OR rec.vehicle_brand<>p_data->>'vehicleBrand'
     OR rec.vehicle_model<>p_data->>'vehicleModel'
     OR rec.area_text<>p_data->>'areaText'
     OR rec.lodging_name IS DISTINCT FROM (p_data->>'lodgingName') THEN
    RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005';
   END IF;
   record_id:=rec.id;
  ELSE
   INSERT INTO app.parking_entry_draft_events
     (entry_id,municipality_id,actor_user_id,trace_id,code,revision)
    VALUES (record_id,mid,actor,p_trace,'entered',1);
  END IF;
 ELSE
  record_id:=(p_data->>'entryId')::uuid;
  SELECT * INTO rec FROM app.parking_entry_drafts
   WHERE id=record_id AND municipality_id=mid FOR UPDATE;
  IF rec.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
  IF rec.status<>'present' OR rec.revision IS DISTINCT FROM (p_data->>'revision')::integer THEN
   RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005';
  END IF;
  UPDATE app.parking_entry_drafts SET status='departed',departure_at=clock_timestamp(),
    revision=revision+1,updated_at=clock_timestamp()
   WHERE id=record_id RETURNING * INTO rec;
  INSERT INTO app.parking_entry_draft_events
    (entry_id,municipality_id,actor_user_id,trace_id,code,revision)
   VALUES (record_id,mid,actor,p_trace,'departed',rec.revision);
 END IF;
 SELECT * INTO rec FROM app.parking_entry_drafts WHERE id=record_id AND municipality_id=mid;
 RETURN jsonb_build_object('entryId',rec.id,'status',rec.status,
  'revision',rec.revision,'entryAt',rec.entry_at,'departureAt',rec.departure_at,
  'authorizationIssued',false,'paymentRegistered',false,'voucherIssued',false);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005';
END $$;

CREATE FUNCTION app.parking_entry_draft_query(p_session text,p_mid uuid,p_after uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active) THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor
  AND municipality_id=p_mid AND active AND role_code='admin-turismo') THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003';
 END IF;
 RETURN jsonb_build_object('items',(
  SELECT coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb)
  FROM (SELECT d.id,d.vehicle_plate AS "vehiclePlate",d.vehicle_brand AS "vehicleBrand",
   d.vehicle_model AS "vehicleModel",d.area_text AS "areaText",
   d.lodging_name AS "lodgingName",d.entry_at AS "entryAt",
   d.departure_at AS "departureAt",d.status,d.revision
   FROM app.parking_entry_drafts d WHERE d.municipality_id=p_mid
    AND (p_after IS NULL OR d.id>p_after)
   ORDER BY d.id LIMIT 21) item
 ));
END $$;

CREATE FUNCTION app.parking_entry_draft_history(p_session text,p_mid uuid,p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.parking_entry_drafts
    WHERE id=p_id AND municipality_id=p_mid)
  OR NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active)
  OR NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor
   AND municipality_id=p_mid AND active AND role_code='admin-turismo') THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004';
 END IF;
 RETURN jsonb_build_object('items',(
  SELECT coalesce(jsonb_agg(jsonb_build_object('code',e.code,
   'revision',e.revision,'createdAt',e.created_at) ORDER BY e.revision),'[]'::jsonb)
  FROM app.parking_entry_draft_events e
   WHERE e.entry_id=p_id AND e.municipality_id=p_mid
 ));
END $$;
REVOKE ALL ON FUNCTION app.parking_entry_draft_mutate(text,jsonb,uuid),
 app.parking_entry_draft_query(text,uuid,uuid),
 app.parking_entry_draft_history(text,uuid,uuid)
 FROM PUBLIC,jeriflow_scanner;
GRANT EXECUTE ON FUNCTION app.parking_entry_draft_mutate(text,jsonb,uuid),
 app.parking_entry_draft_query(text,uuid,uuid),
 app.parking_entry_draft_history(text,uuid,uuid) TO jeriflow_app;
