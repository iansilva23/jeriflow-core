-- App Guarda: primeiro fluxo operacional real, com isolamento municipal.
CREATE TABLE app.guarda_occurrences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 created_by uuid NOT NULL REFERENCES app.identity_users(id),
 client_request_id uuid NOT NULL,
 category text NOT NULL CHECK(category IN ('apoio','transito','patrulhamento','outros')),
 location_text text NOT NULL CHECK(char_length(location_text) BETWEEN 5 AND 120),
 description text NOT NULL CHECK(char_length(description) BETWEEN 20 AND 2000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(created_by,municipality_id,client_request_id)
);
CREATE TABLE app.guarda_occurrence_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 occurrence_id uuid NOT NULL REFERENCES app.guarda_occurrences(id),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
 request_id uuid NOT NULL,
 code text NOT NULL CHECK(code IN ('created','in_progress','resolved')),
 revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX guarda_occurrence_tenant ON app.guarda_occurrences(municipality_id,created_at DESC,id);
REVOKE ALL ON app.guarda_occurrences,app.guarda_occurrence_events FROM PUBLIC,jeriflow_app,jeriflow_scanner;

CREATE FUNCTION app.guarda_mutate(p_session text,p_data jsonb,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; mid uuid; action text; occ app.guarda_occurrences; target uuid; changed text;
BEGIN
 actor:=app.account_actor(p_session,false);
 mid:=(p_data->>'municipalityId')::uuid;
 action:=p_data->>'operation';
 IF mid IS NULL OR action NOT IN ('create','start','resolve') THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=mid AND active)
  OR NOT EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor
   AND m.municipality_id=mid AND m.active AND m.role_code='guarda') THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
 IF action='create' THEN
  IF (p_data->>'category') NOT IN ('apoio','transito','patrulhamento','outros')
   OR char_length(p_data->>'locationText') NOT BETWEEN 5 AND 120
   OR char_length(p_data->>'description') NOT BETWEEN 20 AND 2000
   OR (p_data->>'clientRequestId') IS NULL THEN
   RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
  INSERT INTO app.guarda_occurrences(municipality_id,created_by,client_request_id,category,location_text,description)
  VALUES(mid,actor,(p_data->>'clientRequestId')::uuid,p_data->>'category',
   p_data->>'locationText',p_data->>'description')
  ON CONFLICT(created_by,municipality_id,client_request_id) DO NOTHING RETURNING id INTO target;
  IF target IS NOT NULL THEN
   INSERT INTO app.guarda_occurrence_events(occurrence_id,municipality_id,actor_user_id,request_id,code,revision)
   VALUES(target,mid,actor,p_request,'created',1);
  ELSE
   SELECT * INTO occ FROM app.guarda_occurrences
    WHERE created_by=actor AND municipality_id=mid
      AND client_request_id=(p_data->>'clientRequestId')::uuid;
   IF occ.id IS NULL OR occ.category<>(p_data->>'category')
    OR occ.location_text<>(p_data->>'locationText') OR occ.description<>(p_data->>'description')
    THEN RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005'; END IF;
   target:=occ.id;
  END IF;
 ELSE
  SELECT * INTO occ FROM app.guarda_occurrences
   WHERE id=(p_data->>'occurrenceId')::uuid AND municipality_id=mid FOR UPDATE;
  IF occ.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
  IF occ.revision<>(p_data->>'revision')::integer THEN
   RAISE EXCEPTION 'STALE_REVISION' USING ERRCODE='JF005'; END IF;
  IF (action='start' AND occ.status<>'open') OR
   (action='resolve' AND occ.status<>'in_progress') THEN
   RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='JF005'; END IF;
  changed:=CASE action WHEN 'start' THEN 'in_progress' ELSE 'resolved' END;
  UPDATE app.guarda_occurrences SET status=changed,revision=revision+1,
   updated_at=clock_timestamp() WHERE id=occ.id RETURNING id INTO target;
  INSERT INTO app.guarda_occurrence_events(occurrence_id,municipality_id,actor_user_id,request_id,code,revision)
  VALUES(target,mid,actor,p_request,changed,occ.revision+1);
 END IF;
 SELECT * INTO occ FROM app.guarda_occurrences WHERE id=target;
 RETURN jsonb_build_object('occurrenceId',occ.id,'status',occ.status,'revision',occ.revision);
END $$;
CREATE FUNCTION app.guarda_query(p_session text,p_mid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.memberships m JOIN app.municipalities city
  ON city.id=m.municipality_id AND city.active
  WHERE m.user_id=actor AND m.municipality_id=p_mid AND m.active
  AND m.role_code IN ('guarda','admin-semus')) THEN
   RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb)
 FROM (SELECT g.id,g.municipality_id AS "municipalityId",g.category,
  g.location_text AS "locationText",g.description,g.status,g.revision,
  g.created_at AS "createdAt"
  FROM app.guarda_occurrences g WHERE g.municipality_id=p_mid
  ORDER BY g.created_at DESC,g.id DESC LIMIT 30)q));
END $$;
REVOKE ALL ON FUNCTION app.guarda_mutate(text,jsonb,uuid),
 app.guarda_query(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guarda_mutate(text,jsonb,uuid),
 app.guarda_query(text,uuid) TO jeriflow_app;
