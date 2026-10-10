-- V5.16 — recuperação privada do ACK do protocolo, NÃO novo tipo de protocolo.
-- Original conferido: ZIP SHA-256
-- 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- cidadao-ai/index.html #trafficForm e shared/jeriflow-audit-citizen.js
-- submitTrafficForm(), categoria Trânsito (SEMUS), status RECEBIDA.
--
-- No caso raro de INSERT confirmado no servidor e erro de conexão no ACK,
-- a API consulta o protocolo já gravado pela mesma conta/foto/sha/município.
-- NÃO executa um segundo INSERT e NÃO libera SELECT direto em PII/tabelas.
CREATE FUNCTION app.citizen_v516_traffic_confirm_registered(
  p_mid uuid,p_session_hash text,p_photo_id uuid,p_sha256 text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  citizen record;
  owner_account_id uuid;
  existing_id text;
BEGIN
  IF p_mid IS NULL OR p_photo_id IS NULL
     OR p_session_hash IS NULL OR p_session_hash !~ '^[a-f0-9]{64}$'
     OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$'
  THEN RETURN NULL; END IF;
  SELECT * INTO citizen FROM app.citizen_v516_resolve(p_mid,p_session_hash);
  IF NOT FOUND OR citizen.blocked OR NOT citizen.active THEN RETURN NULL; END IF;
  SELECT a.id INTO owner_account_id
    FROM app.citizen_v516_accounts a
    WHERE a.municipality_id=p_mid AND a.citizen_id=citizen."citizenId" AND a.active;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT p.id INTO existing_id
    FROM app.citizen_v516_traffic_protocols p
    JOIN app.citizen_v516_traffic_photo_owners o
      ON o.photo_id=p.photo_id
      AND o.municipality_id=p.municipality_id
      AND o.citizen_account_id=p.citizen_account_id
      AND o.sha256=p.photo_sha256
    JOIN app.citizen_v516_verified_traffic_media v
      ON v.photo_id=p.photo_id
      AND v.municipality_id=p.municipality_id
      AND v.sha256=p.photo_sha256 AND v.consumed_by=p.id
    WHERE p.municipality_id=p_mid
      AND p.citizen_account_id=owner_account_id
      AND p.guest_device_hash IS NULL
      AND p.photo_id=p_photo_id
      AND p.photo_sha256=p_sha256;
  RETURN existing_id;
END $$;
REVOKE ALL ON FUNCTION
  app.citizen_v516_traffic_confirm_registered(uuid,text,uuid,text)
  FROM PUBLIC,jeriflow_v516_scan_worker;
GRANT EXECUTE ON FUNCTION
  app.citizen_v516_traffic_confirm_registered(uuid,text,uuid,text)
  TO jeriflow_app;
