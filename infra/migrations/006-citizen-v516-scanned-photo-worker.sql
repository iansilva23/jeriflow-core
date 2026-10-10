-- JeriFlow V5.16 — infraestrutura de SEGURANÇA da foto exigida na denúncia de trânsito.
-- Referência obrigatória: cidadao-ai/index.html #trafficForm e
-- shared/jeriflow-audit-citizen.js evidence(file), submitTrafficForm().
-- ZIP SHA256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad.
-- Não cria estado, campo de UI, cobrança nem protocolo adicional.
--
-- Separação de credenciais: aplicação HTTP = jeriflow_app;
-- verificador privado = papel NOLOGIN abaixo, que deverá ser associado a
-- uma credencial de processo DISTINTA pela infraestrutura segura.
-- Sem essa associação o processamento fica indisponível (fail closed).
CREATE ROLE jeriflow_v516_scan_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA app TO jeriflow_v516_scan_worker;

-- No banco só o papel do worker pode registrar uma mídia pré-verificada.
-- A verificação efetiva de bytes/ClamAV ocorre no processo privado antes desta
-- chamada; nenhuma flag do formulário do Cidadão é parâmetro desta função.
CREATE FUNCTION app.citizen_v516_record_scanned_media(
  p_mid uuid,p_photo_id uuid,p_sha256 text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF p_mid IS NULL OR p_photo_id IS NULL OR p_sha256 IS NULL OR
     p_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_VERIFIED_MEDIA' USING ERRCODE='JF001';
  END IF;
  PERFORM 1 FROM app.municipalities WHERE id=p_mid AND active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MUNICIPALITY_UNAVAILABLE' USING ERRCODE='JF004';
  END IF;
  INSERT INTO app.citizen_v516_verified_traffic_media
    (municipality_id,photo_id,sha256,normalized_mime)
    VALUES(p_mid,p_photo_id,p_sha256,'image/webp');
END $$;

REVOKE ALL ON FUNCTION app.citizen_v516_record_scanned_media(uuid,uuid,text)
  FROM PUBLIC,jeriflow_app;
GRANT EXECUTE ON FUNCTION app.citizen_v516_record_scanned_media(uuid,uuid,text)
  TO jeriflow_v516_scan_worker;

-- O worker não recebe SELECT/UPDATE/DELETE nas tabelas nem EXECUTE em
-- citizen_v516_traffic_submit; o administrador do banco não expõe sua
-- credencial à API HTTP. Defaults das tabelas continuam revogados.
REVOKE ALL ON app.citizen_v516_verified_traffic_media,
  app.citizen_v516_traffic_protocols,
  app.citizen_v516_accounts,app.citizen_v516_sessions
  FROM jeriflow_v516_scan_worker;
