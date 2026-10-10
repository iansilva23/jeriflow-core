-- JeriFlow Turismo: solicitações operacionais (NÃO são reservas, diárias pagas ou comprovantes oficiais).
-- Migração 017 somente aditiva. Nenhuma cobrança, direito de entrada ou integração TTS.
CREATE TABLE app.parking_service_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 author_user_id uuid NOT NULL REFERENCES app.identity_users(id),
 client_request_id uuid NOT NULL,
 vehicle_plate text NOT NULL CHECK (vehicle_plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
 area_text text NOT NULL CHECK (char_length(area_text) BETWEEN 5 AND 120),
 service_day date NOT NULL,
 description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 1000),
 status text NOT NULL DEFAULT 'requested'
  CHECK (status IN ('requested','in_review','answered','rejected')),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>=1),
 admin_response text CHECK (admin_response IS NULL OR char_length(admin_response) BETWEEN 15 AND 1000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(author_user_id,municipality_id,client_request_id)
);
CREATE INDEX parking_requests_tenant_idx ON app.parking_service_requests(municipality_id,id);
CREATE INDEX parking_requests_author_idx ON app.parking_service_requests(author_user_id,municipality_id,id);
CREATE TABLE app.parking_service_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES app.parking_service_requests(id),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
 trace_id uuid NOT NULL,
 code text NOT NULL CHECK(code IN ('created','triaged','answered','rejected')),
 revision integer NOT NULL CHECK(revision>=1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(request_id,revision)
);
CREATE INDEX parking_events_request_idx ON app.parking_service_events(request_id,revision);
REVOKE ALL ON app.parking_service_requests,app.parking_service_events
 FROM PUBLIC,jeriflow_app,jeriflow_scanner;

CREATE FUNCTION app.parking_service_mutate(p_session text,p_data jsonb,p_trace uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; mid uuid; op text; target uuid; entry app.parking_service_requests;
 is_tourist boolean; is_admin boolean; next_status text; reply text;
BEGIN
 actor:=app.account_actor(p_session,false);
 mid:=(p_data->>'municipalityId')::uuid;
 op:=p_data->>'operation';
 IF mid IS NULL OR op IS NULL OR op NOT IN ('create','triage','answer','reject') THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
 END IF;
 PERFORM 1 FROM app.municipalities WHERE id=mid AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 SELECT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor AND municipality_id=mid
    AND role_code='turista' AND active),
  EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor AND municipality_id=mid
    AND role_code='admin-turismo' AND active) INTO is_tourist,is_admin;
 IF (op='create' AND NOT is_tourist) OR (op<>'create' AND NOT is_admin) THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
 IF op='create' THEN
  IF p_data->>'clientRequestId' IS NULL
   OR p_data->>'vehiclePlate' !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'
   OR char_length(p_data->>'areaText') NOT BETWEEN 5 AND 120
   OR char_length(p_data->>'description') NOT BETWEEN 10 AND 1000
   OR p_data->>'serviceDay' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
  END IF;
  INSERT INTO app.parking_service_requests
   (municipality_id,author_user_id,client_request_id,vehicle_plate,area_text,service_day,description)
  VALUES(mid,actor,(p_data->>'clientRequestId')::uuid,p_data->>'vehiclePlate',
   p_data->>'areaText',(p_data->>'serviceDay')::date,p_data->>'description')
  ON CONFLICT(author_user_id,municipality_id,client_request_id) DO NOTHING
  RETURNING id INTO target;
  IF target IS NULL THEN
   SELECT * INTO entry FROM app.parking_service_requests
   WHERE municipality_id=mid AND author_user_id=actor
    AND client_request_id=(p_data->>'clientRequestId')::uuid;
   IF entry.id IS NULL OR entry.vehicle_plate<>p_data->>'vehiclePlate'
    OR entry.area_text<>p_data->>'areaText'
    OR entry.description<>p_data->>'description'
    OR entry.service_day<>(p_data->>'serviceDay')::date THEN
    RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005'; END IF;
   target:=entry.id;
  ELSE
   INSERT INTO app.parking_service_events(request_id,municipality_id,actor_user_id,trace_id,code,revision)
   VALUES(target,mid,actor,p_trace,'created',1);
  END IF;
 ELSE
  target:=(p_data->>'requestId')::uuid;
  SELECT * INTO entry FROM app.parking_service_requests
   WHERE id=target AND municipality_id=mid FOR UPDATE;
  IF entry.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
  IF entry.revision IS DISTINCT FROM (p_data->>'revision')::integer
   OR (op='triage' AND entry.status<>'requested')
   OR (op IN ('answer','reject') AND entry.status<>'in_review') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='JF005'; END IF;
  reply:=p_data->>'message';
  IF op IN ('answer','reject') AND (reply IS NULL OR char_length(reply) NOT BETWEEN 15 AND 1000) THEN
   RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
  next_status:=CASE op WHEN 'triage' THEN 'in_review'
    WHEN 'answer' THEN 'answered' ELSE 'rejected' END;
  UPDATE app.parking_service_requests SET status=next_status,revision=revision+1,
    admin_response=CASE WHEN op IN ('answer','reject') THEN reply ELSE admin_response END,
    updated_at=clock_timestamp() WHERE id=target RETURNING * INTO entry;
  INSERT INTO app.parking_service_events(request_id,municipality_id,actor_user_id,trace_id,code,revision)
   VALUES(target,mid,actor,p_trace,CASE op WHEN 'triage' THEN 'triaged'
    WHEN 'answer' THEN 'answered' ELSE 'rejected' END,entry.revision);
 END IF;
 SELECT * INTO entry FROM app.parking_service_requests WHERE id=target AND municipality_id=mid;
 RETURN jsonb_build_object('requestId',entry.id,'status',entry.status,'revision',entry.revision,
   'authorizationIssued',false,'paymentRegistered',false);
END $$;

CREATE FUNCTION app.parking_service_query(p_session text,p_mid uuid,p_scope text,p_after uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF p_scope IS NULL OR p_scope NOT IN ('mine','queue')
  OR NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active) THEN
   RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.memberships m
  WHERE m.user_id=actor AND m.municipality_id=p_mid AND m.active
   AND m.role_code=CASE p_scope WHEN 'mine' THEN 'turista' ELSE 'admin-turismo' END) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
 RETURN jsonb_build_object('items',(
  SELECT coalesce(jsonb_agg(to_jsonb(row_data)),'[]'::jsonb)
  FROM (SELECT r.id,r.vehicle_plate AS "vehiclePlate",r.area_text AS "areaText",
    r.service_day::text AS "serviceDay",r.description,r.status,r.revision,
    r.admin_response AS "adminResponse",r.created_at AS "createdAt",
    r.updated_at AS "updatedAt"
   FROM app.parking_service_requests r
   WHERE r.municipality_id=p_mid AND (p_scope='queue' OR r.author_user_id=actor)
    AND (p_after IS NULL OR r.id>p_after)
   ORDER BY r.id LIMIT 21) row_data
 ));
END $$;
CREATE FUNCTION app.parking_service_history(p_session text,p_mid uuid,p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; author_id uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 SELECT author_user_id INTO author_id FROM app.parking_service_requests
 WHERE id=p_id AND municipality_id=p_mid;
 IF author_id IS NULL OR NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active)
  OR NOT EXISTS(SELECT 1 FROM app.memberships m
    WHERE m.user_id=actor AND m.municipality_id=p_mid AND m.active
    AND (m.role_code='admin-turismo' OR (author_id=actor AND m.role_code='turista'))) THEN
   RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 RETURN jsonb_build_object('items',(
  SELECT coalesce(jsonb_agg(jsonb_build_object('code',e.code,
    'revision',e.revision,'createdAt',e.created_at) ORDER BY e.revision),'[]'::jsonb)
  FROM app.parking_service_events e WHERE e.request_id=p_id AND e.municipality_id=p_mid
 ));
END $$;
REVOKE ALL ON FUNCTION app.parking_service_mutate(text,jsonb,uuid),
 app.parking_service_query(text,uuid,text,uuid),app.parking_service_history(text,uuid,uuid)
 FROM PUBLIC,jeriflow_scanner;
GRANT EXECUTE ON FUNCTION app.parking_service_mutate(text,jsonb,uuid),
 app.parking_service_query(text,uuid,text,uuid),app.parking_service_history(text,uuid,uuid)
 TO jeriflow_app;
