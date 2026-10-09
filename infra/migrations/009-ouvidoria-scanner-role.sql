-- Operação do scanner com privilégio mínimo. Executar pelo administrador
-- de migrações; NÃO conceder login/credenciais ao papel de serviço aqui.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='jeriflow_scanner') THEN
    CREATE ROLE jeriflow_scanner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles
      WHERE rolname='jeriflow_scanner' AND rolcanlogin) THEN
    RAISE EXCEPTION 'SCANNER_ROLE_UNEXPECTED_LOGIN';
  END IF;
END; $;
DO $ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO jeriflow_scanner',current_database()); END $;
GRANT USAGE ON SCHEMA app TO jeriflow_scanner;
-- Nenhum acesso direto a app.ouvidoria_attachments ou às tabelas de auditoria.
REVOKE ALL ON app.ouvidoria_attachments,
  app.ouvidoria_attachment_scan_events FROM jeriflow_scanner;

CREATE FUNCTION app.ouvidoria_scan_claim(p_lease uuid)
RETURNS TABLE(id uuid, municipality_id uuid, protocol_id uuid,
  client_request_id uuid, size_bytes integer, sha256 text, encrypted_bytes bytea)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
  WITH target AS (
    SELECT a.id FROM app.ouvidoria_attachments a
    WHERE a.scan_attempts<3
      AND (a.scan_status='quarantined'
        OR (a.scan_status='scanning'
          AND a.scan_started_at<clock_timestamp()-interval '3 minutes'))
    ORDER BY a.created_at,a.id
    FOR UPDATE SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE app.ouvidoria_attachments a
      SET scan_status='scanning',scan_started_at=clock_timestamp(),
          scan_lease=p_lease,scan_attempts=scan_attempts+1
    FROM target WHERE a.id=target.id
    RETURNING a.id,a.municipality_id,a.protocol_id,a.client_request_id,
      a.size_bytes,a.sha256,a.encrypted_bytes
  ) SELECT c.id,c.municipality_id,c.protocol_id,c.client_request_id,
           c.size_bytes,c.sha256,c.encrypted_bytes FROM claimed c;
$$;

CREATE FUNCTION app.ouvidoria_scan_finish(p_attachment uuid,p_lease uuid,
  p_result text,p_version text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE finished uuid;
BEGIN
  IF p_result NOT IN ('clean','rejected','quarantined') OR
    p_version IS NULL OR p_version !~ '^[a-zA-Z0-9._-]{1,80}$' THEN
    RAISE EXCEPTION 'INVALID_SCAN_RESULT' USING ERRCODE='JF001';
  END IF;
  UPDATE app.ouvidoria_attachments
    SET scan_status=p_result,scan_started_at=NULL,scan_lease=NULL
    WHERE id=p_attachment AND scan_status='scanning' AND scan_lease=p_lease
    RETURNING id INTO finished;
  IF finished IS NULL THEN RETURN false; END IF;
  INSERT INTO app.ouvidoria_attachment_scan_events(attachment_id,result,scanner_version)
    VALUES(finished,CASE WHEN p_result='quarantined' THEN 'retry' ELSE p_result END,p_version);
  RETURN true;
END; $;

REVOKE ALL ON FUNCTION app.ouvidoria_scan_claim(uuid),
  app.ouvidoria_scan_finish(uuid,uuid,text,text) FROM PUBLIC,jeriflow_app;
GRANT EXECUTE ON FUNCTION app.ouvidoria_scan_claim(uuid),
  app.ouvidoria_scan_finish(uuid,uuid,text,text) TO jeriflow_scanner;
