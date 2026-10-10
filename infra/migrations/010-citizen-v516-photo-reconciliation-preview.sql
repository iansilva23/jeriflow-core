-- V5.16 / Etapa 20 — auditoria privada e NAO DESTRUTIVA de fotos pendentes.
-- Autoridade: JERIFLOW_ECOSISTEMA_SUPREMO_V5_16_AUTORIZACAO_E_CADASTROS_APPS_FINAL.zip
-- SHA-256: 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- Referencia: cidadao-ai/index.html #trafficForm e
-- shared/jeriflow-audit-citizen.js evidence()/submitTrafficForm().
--
-- Nunca apaga fotos ou protocolos; nunca cria estados do produto.
-- Consulta sob role distinta, sem permissao para app HTTP, scanner ou visitante.
CREATE ROLE jeriflow_v516_reconciler NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA app TO jeriflow_v516_reconciler;

CREATE FUNCTION app.citizen_v516_traffic_reconcile_preview(
  p_mid uuid,p_older_than_hours integer,p_limit integer
) RETURNS TABLE(
  municipality_id uuid,photo_id uuid,sha256 text,
  has_scanner_record boolean,age_hours integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF p_mid IS NULL OR p_older_than_hours IS NULL
     OR p_older_than_hours < 72 OR p_older_than_hours > 8760
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100
  THEN
    RAISE EXCEPTION 'INVALID_RECONCILIATION_WINDOW' USING ERRCODE='JF001';
  END IF;
  RETURN QUERY
  SELECT o.municipality_id,o.photo_id,o.sha256,
    (v.photo_id IS NOT NULL),
    floor(extract(epoch FROM clock_timestamp()-o.reserved_at)/3600)::integer
  FROM app.citizen_v516_traffic_photo_owners o
  LEFT JOIN app.citizen_v516_verified_traffic_media v
    ON v.photo_id=o.photo_id AND v.municipality_id=o.municipality_id
  WHERE o.municipality_id=p_mid
    AND o.reserved_at < clock_timestamp()-make_interval(hours=>p_older_than_hours)
    AND (v.photo_id IS NULL OR (
       v.sha256=o.sha256 AND v.consumed_by IS NULL
       AND v.verified_at < clock_timestamp()-make_interval(hours=>p_older_than_hours)))
    -- Qualquer protocolo e referencia na tentativa bloqueiam a candidatura.
    AND NOT EXISTS (
      SELECT 1 FROM app.citizen_v516_traffic_protocols p
      WHERE p.photo_id=o.photo_id)
    AND NOT EXISTS (
      SELECT 1 FROM app.citizen_v516_traffic_attempts a
      WHERE a.photo_id=o.photo_id)
    -- Uma tentativa recente em andamento dessa conta pode estar entre
    -- store/scan/registro de tentativa: nao tocar nenhuma foto da conta.
    AND NOT EXISTS (
      SELECT 1 FROM app.citizen_v516_traffic_attempts active
      WHERE active.municipality_id=o.municipality_id
        AND active.citizen_account_id=o.citizen_account_id
        AND active.technical_state<>'COMPLETE'
        AND (
          active.updated_at>=clock_timestamp()-interval '72 hours'
          OR active.lease_expires_at>=clock_timestamp()-interval '72 hours'
        ))
  ORDER BY o.reserved_at,o.photo_id
  LIMIT p_limit;
END $$;

-- Negar a invocacao direta da API, do papel scanner e de PUBLIC.
REVOKE ALL ON FUNCTION
 app.citizen_v516_traffic_reconcile_preview(uuid,integer,integer)
 FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker;
GRANT EXECUTE ON FUNCTION
 app.citizen_v516_traffic_reconcile_preview(uuid,integer,integer)
 TO jeriflow_v516_reconciler;
REVOKE ALL ON app.citizen_v516_traffic_photo_owners,
 app.citizen_v516_verified_traffic_media,
 app.citizen_v516_traffic_protocols,
 app.citizen_v516_traffic_attempts
 FROM jeriflow_v516_reconciler;
