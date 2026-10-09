-- Ouvidoria: armazenagem cifrada e quarentena fail-closed.
-- Sem rota de leitura dos bytes, sem aprovação manual e sem liberação antes de scanner.
CREATE TABLE app.ouvidoria_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
  protocol_id uuid NOT NULL REFERENCES app.ouvidoria_protocols(id),
  uploaded_by uuid NOT NULL REFERENCES app.identity_users(id),
  client_request_id uuid NOT NULL,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 80),
  media_type text NOT NULL CHECK (media_type IN ('image/jpeg','image/png','application/pdf')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 32 AND 1048576),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  encrypted_bytes bytea NOT NULL CHECK (octet_length(encrypted_bytes) BETWEEN 60 AND 1048612),
  scan_status text NOT NULL DEFAULT 'quarantined' CHECK (scan_status IN ('quarantined','rejected','clean')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (uploaded_by, municipality_id, client_request_id)
);
CREATE INDEX ouvidoria_attachments_protocol_idx ON app.ouvidoria_attachments(protocol_id,created_at,id);
CREATE TABLE app.ouvidoria_attachment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES app.ouvidoria_attachments(id),
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
  protocol_id uuid NOT NULL REFERENCES app.ouvidoria_protocols(id),
  actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
  request_id uuid NOT NULL,
  event_code text NOT NULL CHECK (event_code IN ('quarantined','rejected','scan_clean')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ouvidoria_attachment_events_idx ON app.ouvidoria_attachment_events(attachment_id,created_at);
REVOKE ALL ON app.ouvidoria_attachment_events FROM PUBLIC, jeriflow_app;

REVOKE ALL ON app.ouvidoria_attachments FROM PUBLIC, jeriflow_app;

CREATE FUNCTION app.ouvidoria_attachment_authorized(p_session text,p_mid uuid,p_pid uuid,p_upload boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; author uuid; protocol_status text; allowed boolean;
BEGIN
  actor := app.account_actor(p_session,false);
  SELECT p.author_user_id,p.status INTO author,protocol_status
    FROM app.ouvidoria_protocols p
    JOIN app.municipalities m ON m.id=p.municipality_id AND m.active
    WHERE p.id=p_pid AND p.municipality_id=p_mid
    FOR UPDATE OF p;
  IF author IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
  SELECT EXISTS(SELECT 1 FROM app.memberships mem WHERE mem.user_id=actor
    AND mem.municipality_id=p_mid AND mem.active
    AND (mem.role_code='admin-cidadao' OR (mem.role_code='cidadao' AND author=actor)))
    INTO allowed;
  IF NOT allowed THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
  IF p_upload AND protocol_status='closed' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='JF005';
  END IF;
  RETURN actor;
END $$;

CREATE FUNCTION app.ouvidoria_attachment_put(p_session text,p_data jsonb,
  p_encrypted bytea,p_hash text,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE mid uuid; pid uuid; actor uuid; existing app.ouvidoria_attachments; added uuid;
  n integer;
BEGIN
  mid := (p_data->>'municipalityId')::uuid;pid := (p_data->>'protocolId')::uuid;
  actor := app.ouvidoria_attachment_authorized(p_session,mid,pid,true);
  IF p_encrypted IS NULL OR octet_length(p_encrypted)<60 OR octet_length(p_encrypted)>1048612
    OR p_hash !~ '^[a-f0-9]{64}$'
    OR (p_data->>'mediaType') NOT IN ('image/jpeg','image/png','application/pdf')
    OR char_length(p_data->>'fileName') NOT BETWEEN 1 AND 80
    OR (p_data->>'sizeBytes')::integer NOT BETWEEN 32 AND 1048576 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
  END IF;
  SELECT * INTO existing FROM app.ouvidoria_attachments
    WHERE uploaded_by=actor AND municipality_id=mid
      AND client_request_id=(p_data->>'clientRequestId')::uuid;
  IF existing.id IS NOT NULL THEN
    IF existing.protocol_id<>pid OR existing.sha256<>p_hash
      OR existing.file_name<>(p_data->>'fileName')
      OR existing.media_type<>(p_data->>'mediaType')
      OR existing.size_bytes<>(p_data->>'sizeBytes')::integer THEN
      RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005';
    END IF;
    RETURN jsonb_build_object('attachmentId',existing.id,'status',existing.scan_status);
  END IF;
  SELECT count(*) INTO n FROM app.ouvidoria_attachments WHERE protocol_id=pid;
  IF n>=5 THEN RAISE EXCEPTION 'ATTACHMENT_LIMIT' USING ERRCODE='JF005'; END IF;
  INSERT INTO app.ouvidoria_attachments(municipality_id,protocol_id,uploaded_by,
    client_request_id,file_name,media_type,size_bytes,sha256,encrypted_bytes)
  VALUES(mid,pid,actor,(p_data->>'clientRequestId')::uuid,p_data->>'fileName',
    p_data->>'mediaType',(p_data->>'sizeBytes')::integer,p_hash,p_encrypted)
  RETURNING id INTO added;
  INSERT INTO app.ouvidoria_attachment_events
    (attachment_id,municipality_id,protocol_id,actor_user_id,request_id,event_code)
    VALUES(added,mid,pid,actor,p_request,'quarantined');
  RETURN jsonb_build_object('attachmentId',added,'status','quarantined');
END $$;

CREATE FUNCTION app.ouvidoria_attachment_list(p_session text,p_mid uuid,p_pid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  actor := app.ouvidoria_attachment_authorized(p_session,p_mid,p_pid,false);
  RETURN jsonb_build_object('items',(
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'fileName',a.file_name,
      'mediaType',a.media_type,'sizeBytes',a.size_bytes,'status',a.scan_status,
      'createdAt',a.created_at) ORDER BY a.created_at,a.id),'[]'::jsonb)
    FROM app.ouvidoria_attachments a WHERE a.protocol_id=p_pid AND a.municipality_id=p_mid
  ));
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_attachment_authorized(text,uuid,uuid,boolean),
  app.ouvidoria_attachment_put(text,jsonb,bytea,text,uuid),
  app.ouvidoria_attachment_list(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ouvidoria_attachment_put(text,jsonb,bytea,text,uuid),
  app.ouvidoria_attachment_list(text,uuid,uuid) TO jeriflow_app;
