-- Primeiro fluxo operacional da Guarda/SEMUS, exclusivamente desenvolvimento e dados fictícios.
CREATE TABLE app.guarda_occurrences(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 created_by uuid NOT NULL REFERENCES app.identity_users(id),
 client_request_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('ocorrencia','apoio','orientacao','outro')),
 title text NOT NULL CHECK(char_length(title) BETWEEN 8 AND 120),
 description text NOT NULL CHECK(char_length(description) BETWEEN 20 AND 2000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','closed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(created_by,municipality_id,client_request_id)
);
CREATE INDEX guarda_occurrences_list_idx ON app.guarda_occurrences(municipality_id,id);
CREATE TABLE app.guarda_occurrence_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 occurrence_id uuid NOT NULL REFERENCES app.guarda_occurrences(id),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
 request_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('created','reviewed','closed')),
 revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON app.guarda_occurrences,app.guarda_occurrence_events FROM PUBLIC,jeriflow_app,jeriflow_scanner;
CREATE FUNCTION app.guarda_query(p_session text,p_mid uuid,p_after uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; is_admin boolean; is_guarda boolean;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active) THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 SELECT EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor AND m.municipality_id=p_mid
      AND m.active AND m.role_code='admin-semus'),
   EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor AND m.municipality_id=p_mid
      AND m.active AND m.role_code='guarda') INTO is_admin,is_guarda;
 IF NOT is_admin AND NOT is_guarda THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
 RETURN jsonb_build_object('items',(
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (
   SELECT o.id,o.kind,o.title,o.description,o.status,o.revision,
          o.created_at AS "createdAt",o.updated_at AS "updatedAt"
     FROM app.guarda_occurrences o WHERE o.municipality_id=p_mid
     AND (is_admin OR o.created_by=actor)
     AND (p_after IS NULL OR o.id>p_after)
    ORDER BY o.id LIMIT 21
  ) q
 ));
END $$;
CREATE FUNCTION app.guarda_mutate(p_session text,p_data jsonb,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; mid uuid; op text; pid uuid; row_app app.guarda_occurrences;
  is_admin boolean; is_guarda boolean; revised integer;
BEGIN
 actor:=app.account_actor(p_session,false);
 mid:=(p_data->>'municipalityId')::uuid;op:=p_data->>'operation';
 IF mid IS NULL OR op NOT IN ('create','review','close') OR op IS NULL THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
 PERFORM 1 FROM app.municipalities WHERE id=mid AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 SELECT EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor AND m.municipality_id=mid
      AND m.active AND m.role_code='admin-semus'),
   EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor AND m.municipality_id=mid
      AND m.active AND m.role_code='guarda') INTO is_admin,is_guarda;
 IF (op='create' AND NOT is_guarda) OR (op IN ('review','close') AND NOT is_admin) THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
 IF op='create' THEN
  IF (p_data->>'kind') NOT IN ('ocorrencia','apoio','orientacao','outro')
   OR char_length(p_data->>'title') NOT BETWEEN 8 AND 120
   OR char_length(p_data->>'description') NOT BETWEEN 20 AND 2000
   OR p_data->>'clientRequestId' IS NULL THEN
   RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
  INSERT INTO app.guarda_occurrences(municipality_id,created_by,client_request_id,kind,title,description)
    VALUES(mid,actor,(p_data->>'clientRequestId')::uuid,p_data->>'kind',
      p_data->>'title',p_data->>'description')
    ON CONFLICT (created_by,municipality_id,client_request_id) DO NOTHING RETURNING id INTO pid;
  IF pid IS NULL THEN
   SELECT id INTO pid FROM app.guarda_occurrences WHERE created_by=actor AND municipality_id=mid
      AND client_request_id=(p_data->>'clientRequestId')::uuid;
   -- Reenvios idempotentes não podem mudar conteúdo.
   IF NOT EXISTS(SELECT 1 FROM app.guarda_occurrences WHERE id=pid
     AND kind=p_data->>'kind' AND title=p_data->>'title' AND description=p_data->>'description') THEN
     RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005'; END IF;
  ELSE
   INSERT INTO app.guarda_occurrence_events(occurrence_id,municipality_id,actor_user_id,request_id,action,revision)
    VALUES(pid,mid,actor,p_request,'created',1);
  END IF;
 ELSE
  pid:=(p_data->>'occurrenceId')::uuid; revised:=(p_data->>'revision')::integer;
  IF pid IS NULL OR revised IS NULL OR revised<1 THEN
   RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
  SELECT * INTO row_app FROM app.guarda_occurrences WHERE id=pid AND municipality_id=mid FOR UPDATE;
  IF row_app.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
  IF row_app.revision<>revised OR (op='review' AND row_app.status<>'open')
      OR (op='close' AND row_app.status<>'in_review') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='JF005'; END IF;
  UPDATE app.guarda_occurrences SET status=CASE op WHEN 'review' THEN 'in_review' ELSE 'closed' END,
    revision=revision+1,updated_at=clock_timestamp() WHERE id=pid RETURNING * INTO row_app;
  INSERT INTO app.guarda_occurrence_events(occurrence_id,municipality_id,actor_user_id,request_id,action,revision)
    VALUES(pid,mid,actor,p_request,CASE op WHEN 'review' THEN 'reviewed' ELSE 'closed' END,row_app.revision);
 END IF;
 SELECT * INTO row_app FROM app.guarda_occurrences WHERE id=pid;
 RETURN jsonb_build_object('occurrenceId',row_app.id,'status',row_app.status,'revision',row_app.revision);
END $$;
REVOKE ALL ON FUNCTION app.guarda_query(text,uuid,uuid),
 app.guarda_mutate(text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guarda_query(text,uuid,uuid),
 app.guarda_mutate(text,jsonb,uuid) TO jeriflow_app;
