-- Bloco operacional Ouvidoria v1: tabela privada e funções estreitas, sem CRUD direto pela API.
-- Migração aditiva: não modificar 001-003 nem apagar dados antigos.
CREATE TABLE app.ouvidoria_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
  author_user_id uuid NOT NULL REFERENCES app.identity_users(id),
  client_request_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('denuncia','reclamacao','solicitacao','sugestao')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 120),
  description text NOT NULL CHECK (char_length(description) BETWEEN 20 AND 4000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_review','responded','contested','closed')),
  response text,
  contest_note text,
  contest_count smallint NOT NULL DEFAULT 0 CHECK (contest_count BETWEEN 0 AND 1),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (author_user_id, municipality_id, client_request_id),
  CHECK (response IS NULL OR char_length(response) BETWEEN 15 AND 2000),
  CHECK (contest_note IS NULL OR char_length(contest_note) BETWEEN 15 AND 2000)
);
CREATE INDEX ouvidoria_tenant_list_idx ON app.ouvidoria_protocols(municipality_id,id);
CREATE INDEX ouvidoria_author_list_idx ON app.ouvidoria_protocols(author_user_id,municipality_id,id);

CREATE TABLE app.ouvidoria_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id uuid NOT NULL REFERENCES app.ouvidoria_protocols(id),
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
  actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
  request_id uuid NOT NULL,
  event_code text NOT NULL CHECK (event_code IN ('created','triaged','responded','contested','closed')),
  revision integer NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ouvidoria_events_protocol_idx ON app.ouvidoria_events(protocol_id,created_at);
-- Sem concessão direta de SELECT/INSERT/UPDATE/DELETE ao usuário da API.
REVOKE ALL ON app.ouvidoria_protocols, app.ouvidoria_events FROM PUBLIC, jeriflow_app;

CREATE FUNCTION app.ouvidoria_query(p_session text, p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE actor uuid; mid uuid; scope text; after_id uuid;
BEGIN
  actor := app.account_actor(p_session,false);
  mid := (p_data->>'municipalityId')::uuid;
  scope := p_data->>'scope';
  after_id := nullif(p_data->>'after','')::uuid;
  IF scope NOT IN ('meus','fila') OR scope IS NULL OR mid IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
  END IF;
  PERFORM 1 FROM app.municipalities WHERE id=mid AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
  PERFORM 1 FROM app.memberships
    WHERE user_id=actor AND municipality_id=mid AND active
      AND role_code=CASE scope WHEN 'meus' THEN 'cidadao' ELSE 'admin-cidadao' END;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
  RETURN jsonb_build_object('items',(
    SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
      SELECT p.id,p.municipality_id AS "municipalityId",p.category,p.title,p.description,
        p.status,p.response,p.contest_note AS "contestNote",p.contest_count AS "contestCount",
        p.revision,p.created_at AS "createdAt",p.updated_at AS "updatedAt"
      FROM app.ouvidoria_protocols p WHERE p.municipality_id=mid
        AND (scope='fila' OR p.author_user_id=actor)
        AND (after_id IS NULL OR p.id>after_id)
      ORDER BY p.id LIMIT 21
    ) q
  ));
END $$;

CREATE FUNCTION app.ouvidoria_mutate(p_session text, p_data jsonb, p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE actor uuid; mid uuid; op text; pid uuid; record app.ouvidoria_protocols;
  is_citizen boolean; is_staff boolean; msg text; selected_revision integer;
BEGIN
  actor := app.account_actor(p_session,false);
  mid := (p_data->>'municipalityId')::uuid;
  op := p_data->>'operation';
  IF mid IS NULL OR op IS NULL OR op NOT IN ('create','triage','respond','contest','close') THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
  END IF;
  PERFORM 1 FROM app.municipalities WHERE id=mid AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
  SELECT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor AND municipality_id=mid
      AND active AND role_code='cidadao'),
    EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor AND municipality_id=mid
      AND active AND role_code='admin-cidadao')
    INTO is_citizen,is_staff;
  IF (op IN ('create','contest') AND NOT is_citizen)
      OR (op IN ('triage','respond','close') AND NOT is_staff) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003';
  END IF;
  IF op='create' THEN
    IF (p_data->>'category') NOT IN ('denuncia','reclamacao','solicitacao','sugestao')
      OR p_data->>'clientRequestId' IS NULL
      OR char_length(p_data->>'title') NOT BETWEEN 5 AND 120
      OR char_length(p_data->>'description') NOT BETWEEN 20 AND 4000 THEN
      RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
    END IF;
    INSERT INTO app.ouvidoria_protocols
      (municipality_id,author_user_id,client_request_id,category,title,description)
      VALUES (mid,actor,(p_data->>'clientRequestId')::uuid,
        p_data->>'category',p_data->>'title',p_data->>'description')
      ON CONFLICT (author_user_id,municipality_id,client_request_id) DO NOTHING
      RETURNING id INTO pid;
    IF pid IS NOT NULL THEN
      INSERT INTO app.ouvidoria_events(protocol_id,municipality_id,actor_user_id,request_id,event_code,revision)
        VALUES (pid,mid,actor,p_request,'created',1);
    ELSE
      SELECT id INTO pid FROM app.ouvidoria_protocols
        WHERE author_user_id=actor AND municipality_id=mid
          AND client_request_id=(p_data->>'clientRequestId')::uuid;
    END IF;
    SELECT * INTO record FROM app.ouvidoria_protocols WHERE id=pid;
    RETURN jsonb_build_object('protocolId',record.id,'status',record.status,'revision',record.revision);
  END IF;
  pid := (p_data->>'protocolId')::uuid;
  selected_revision := (p_data->>'revision')::integer;
  IF pid IS NULL OR selected_revision IS NULL OR selected_revision < 1 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
  END IF;
  SELECT * INTO record FROM app.ouvidoria_protocols
    WHERE id=pid AND municipality_id=mid FOR UPDATE;
  IF record.id IS NULL OR (op='contest' AND record.author_user_id<>actor) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004';
  END IF;
  IF record.revision<>selected_revision THEN
    RAISE EXCEPTION 'STALE_REVISION' USING ERRCODE='JF005';
  END IF;
  IF (op='triage' AND record.status<>'open')
    OR (op='respond' AND record.status NOT IN ('open','in_review','contested'))
    OR (op='contest' AND (record.status<>'responded' OR record.contest_count<>0))
    OR (op='close' AND record.status<>'responded') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='JF005';
  END IF;
  msg := p_data->>'message';
  IF op IN ('respond','contest') AND
    (msg IS NULL OR char_length(msg) NOT BETWEEN 15 AND 2000) THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
  END IF;
  UPDATE app.ouvidoria_protocols SET
    status=CASE op WHEN 'triage' THEN 'in_review' WHEN 'respond' THEN 'responded'
      WHEN 'contest' THEN 'contested' WHEN 'close' THEN 'closed' END,
    response=CASE WHEN op='respond' THEN msg ELSE response END,
    contest_note=CASE WHEN op='contest' THEN msg ELSE contest_note END,
    contest_count=contest_count+CASE WHEN op='contest' THEN 1 ELSE 0 END,
    revision=revision+1,updated_at=clock_timestamp()
    WHERE id=pid RETURNING * INTO record;
  INSERT INTO app.ouvidoria_events(protocol_id,municipality_id,actor_user_id,request_id,event_code,revision)
    VALUES (pid,mid,actor,p_request,CASE op WHEN 'triage' THEN 'triaged'
      WHEN 'respond' THEN 'responded' WHEN 'contest' THEN 'contested' ELSE 'closed' END,record.revision);
  RETURN jsonb_build_object('protocolId',pid,'status',record.status,'revision',record.revision);
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_query(text,jsonb),app.ouvidoria_mutate(text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ouvidoria_query(text,jsonb),app.ouvidoria_mutate(text,jsonb,uuid) TO jeriflow_app;
