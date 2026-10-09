-- Porta de leitura somente para testes locais; API de producao permanece bloqueada.
CREATE TABLE app.ouvidoria_attachment_access_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES app.ouvidoria_attachments(id),
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
  protocol_id uuid NOT NULL REFERENCES app.ouvidoria_protocols(id),
  actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
  request_id uuid NOT NULL,
  event_code text NOT NULL DEFAULT 'read_test' CHECK(event_code='read_test'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON app.ouvidoria_attachment_access_events FROM PUBLIC, jeriflow_app;
CREATE INDEX ouvidoria_attachment_access_idx
  ON app.ouvidoria_attachment_access_events(attachment_id,created_at);

CREATE FUNCTION app.ouvidoria_attachment_read_test(
  p_session text,p_mid uuid,p_pid uuid,p_attachment uuid,p_request uuid
) RETURNS TABLE (encrypted_bytes bytea, client_request_id uuid, sha256 text,
                 file_name text, media_type text, size_bytes integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; selected app.ouvidoria_attachments;
BEGIN
  actor := app.ouvidoria_attachment_authorized(p_session,p_mid,p_pid,false);
  SELECT * INTO selected FROM app.ouvidoria_attachments a
    WHERE a.id=p_attachment AND a.municipality_id=p_mid AND a.protocol_id=p_pid
      AND a.scan_status='clean'
      AND (SELECT e.result FROM app.ouvidoria_attachment_scan_events e
        WHERE e.attachment_id=a.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1)='clean'
    FOR SHARE;
  IF selected.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
  INSERT INTO app.ouvidoria_attachment_access_events(
      attachment_id,municipality_id,protocol_id,actor_user_id,request_id)
    VALUES(selected.id,p_mid,p_pid,actor,p_request);
  RETURN QUERY SELECT selected.encrypted_bytes,selected.client_request_id,
    selected.sha256,selected.file_name,selected.media_type,selected.size_bytes;
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_attachment_read_test(text,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ouvidoria_attachment_read_test(text,uuid,uuid,uuid,uuid) TO jeriflow_app;
