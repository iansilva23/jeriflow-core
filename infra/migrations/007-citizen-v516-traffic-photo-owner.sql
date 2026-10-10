-- JeriFlow V5.16 — Reserva privada da foto ao proprietário ANTES da varredura.
-- ZIP base original, inspecionado antes de editar:
-- 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- Fonte: cidadao-ai/index.html #trafficForm/submitTrafficForm(), e
-- shared/jeriflow-audit-citizen.js formIdentity(), evidence(), visible().
--
-- Camada invisível ao produto: nenhum campo, papel, pagamento, status ou
-- protocolo novo. O backend da PR30 ainda está DESATIVADO em main.ts.
--
-- A sessão do Cidadão é revalidada NO SERVIDOR, nunca um citizenId enviado
-- pelo aparelho. A reserva pode preceder o scanner, mas a transação do
-- protocolo exige também o registro do scanner na tabela 005.
CREATE TABLE app.citizen_v516_traffic_photo_owners (
  photo_id uuid PRIMARY KEY,
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
  citizen_account_id uuid NOT NULL REFERENCES app.citizen_v516_accounts(id) ON DELETE RESTRICT,
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX citizen_v516_traffic_photo_owner_lookup_idx
  ON app.citizen_v516_traffic_photo_owners
  (municipality_id,citizen_account_id,reserved_at);

-- Roda apenas no backend confiável com hash SHA-256 de token autenticado.
-- O photo_id é UUID emitido pelo store privado, nunca aceito do usuário como
-- credencial de acesso; a API HTTP ainda NÃO liga este mecanismo a produção.
CREATE FUNCTION app.citizen_v516_reserve_traffic_photo(
  p_mid uuid,p_token_hash text,p_photo_id uuid,p_sha256 text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  citizen record;
  linked_account uuid;
BEGIN
  IF p_mid IS NULL OR p_photo_id IS NULL OR p_token_hash IS NULL
     OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'INVALID_TRAFFIC_PHOTO_RESERVATION' USING ERRCODE='JF001';
  END IF;
  SELECT * INTO citizen FROM app.citizen_v516_resolve(p_mid,p_token_hash);
  IF NOT FOUND OR citizen.blocked OR NOT citizen.active THEN
    RAISE EXCEPTION 'CITIZEN_SESSION_NOT_AUTHORIZED' USING ERRCODE='JF003';
  END IF;
  SELECT a.id INTO linked_account
    FROM app.citizen_v516_accounts a
    WHERE a.municipality_id=p_mid AND a.citizen_id=citizen."citizenId"
      AND a.active
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITIZEN_SESSION_NOT_AUTHORIZED' USING ERRCODE='JF003';
  END IF;

  -- A UUID não muda de proprietário e nem de tenant após a primeira reserva.
  -- Violações de unicidade falham fechadas. Não cria gate antimalware.
  INSERT INTO app.citizen_v516_traffic_photo_owners
    (photo_id,municipality_id,citizen_account_id,sha256)
  VALUES(p_photo_id,p_mid,linked_account,p_sha256);
END $$;

-- A inserção de qualquer protocolo canônico de trânsito exige:
-- (1) foto realmente verificada pela role worker da etapa 10, garantida
--     em 005 pela checagem no citizen_v516_traffic_submit;
-- (2) reserva anterior da MESMA UUID/SHA/conta/município;
-- (3) caso visitante ainda não habilitado porque localStorage.deviceId
--     da V5.16 não autentica posse de um dispositivo pela rede.
CREATE FUNCTION app.citizen_v516_require_traffic_photo_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF NEW.citizen_account_id IS NULL OR NEW.guest_device_hash IS NOT NULL THEN
    RAISE EXCEPTION 'GUEST_DEVICE_PROOF_NOT_ESTABLISHED' USING ERRCODE='JF003';
  END IF;
  PERFORM 1
    FROM app.citizen_v516_traffic_photo_owners r
    WHERE r.photo_id=NEW.photo_id
      AND r.municipality_id=NEW.municipality_id
      AND r.citizen_account_id=NEW.citizen_account_id
      AND r.sha256=NEW.photo_sha256
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRAFFIC_PHOTO_OWNER_REQUIRED' USING ERRCODE='JF004';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER citizen_v516_traffic_owner_gate
  BEFORE INSERT OR UPDATE OF
    municipality_id,citizen_account_id,guest_device_hash,photo_id,photo_sha256
  ON app.citizen_v516_traffic_protocols
  FOR EACH ROW EXECUTE FUNCTION app.citizen_v516_require_traffic_photo_owner();

REVOKE ALL ON app.citizen_v516_traffic_photo_owners
  FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker;
REVOKE ALL ON FUNCTION app.citizen_v516_reserve_traffic_photo(uuid,text,uuid,text)
  FROM PUBLIC,jeriflow_v516_scan_worker;
GRANT EXECUTE ON FUNCTION app.citizen_v516_reserve_traffic_photo(uuid,text,uuid,text)
  TO jeriflow_app;
REVOKE ALL ON FUNCTION app.citizen_v516_require_traffic_photo_owner()
  FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker;
