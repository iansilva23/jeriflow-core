-- JeriFlow V5.16 — proteção técnica de repetição do MESMO formulário.
-- Autoridade: ZIP original
-- 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- cidadao-ai/index.html #trafficForm e shared/jeriflow-audit-citizen.js.
-- Status abaixo NÃO são status do produto ou da SEMUS. Protocolo canônico
-- continua sendo citizen_v516_traffic_submit() da migração 005.
CREATE TABLE app.citizen_v516_traffic_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
  citizen_account_id uuid NOT NULL REFERENCES app.citizen_v516_accounts(id),
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
  technical_state text NOT NULL
    CHECK(technical_state IN ('PROCESSING','PHOTO_READY','COMPLETE')),
  lease_id uuid,
  lease_expires_at timestamptz,
  photo_id uuid,
  photo_sha256 text CHECK(photo_sha256 IS NULL OR photo_sha256 ~ '^[a-f0-9]{64}$'),
  protocol_id text REFERENCES app.citizen_v516_traffic_protocols(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(municipality_id,citizen_account_id,payload_sha256),
  CHECK ((photo_id IS NULL AND photo_sha256 IS NULL) OR
         (photo_id IS NOT NULL AND photo_sha256 IS NOT NULL)),
  CHECK (technical_state <> 'PHOTO_READY' OR photo_id IS NOT NULL),
  CHECK (technical_state <> 'COMPLETE' OR
         (protocol_id IS NOT NULL AND photo_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX citizen_v516_traffic_attempts_expired_idx
  ON app.citizen_v516_traffic_attempts(technical_state,lease_expires_at)
  WHERE technical_state <> 'COMPLETE';

-- Exige conta e sessão ativas; nenhum citizenId vindo do cliente.
CREATE FUNCTION app.citizen_v516_traffic_attempt_account(
  p_mid uuid,p_token_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE citizen record; result_id uuid;
BEGIN
  IF p_mid IS NULL OR p_token_hash IS NULL
    OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'CITIZEN_SESSION_INVALID' USING ERRCODE='JF003';
  END IF;
  SELECT * INTO citizen FROM app.citizen_v516_resolve(p_mid,p_token_hash);
  IF NOT FOUND OR citizen.blocked OR NOT citizen.active THEN
    RAISE EXCEPTION 'CITIZEN_SESSION_INVALID' USING ERRCODE='JF003';
  END IF;
  SELECT a.id INTO result_id FROM app.citizen_v516_accounts a
    WHERE a.municipality_id=p_mid AND a.citizen_id=citizen."citizenId"
      AND a.active;
  IF result_id IS NULL THEN
    RAISE EXCEPTION 'CITIZEN_SESSION_INVALID' USING ERRCODE='JF003';
  END IF;
  RETURN result_id;
END $$;

-- Retorno NEW: primeira tentativa; BUSY: não iniciar outra varredura;
-- PHOTO_READY: reutilizar a MESMA imagem varrida (sem novo upload);
-- COMPLETE: devolver ID canônico já gravado. Nenhuma flag do navegador.
CREATE FUNCTION app.citizen_v516_traffic_attempt_begin(
  p_mid uuid,p_token_hash text,p_payload_sha256 text,p_lease uuid
) RETURNS TABLE(outcome text,photo_id uuid,sha256 text,protocol_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE account_id uuid; r app.citizen_v516_traffic_attempts%ROWTYPE;
BEGIN
  IF p_payload_sha256 IS NULL OR
     p_payload_sha256 !~ '^[a-f0-9]{64}$' OR p_lease IS NULL THEN
    RAISE EXCEPTION 'INVALID_TRAFFIC_ATTEMPT' USING ERRCODE='JF001';
  END IF;
  account_id:=app.citizen_v516_traffic_attempt_account(p_mid,p_token_hash);
  INSERT INTO app.citizen_v516_traffic_attempts
    (municipality_id,citizen_account_id,payload_sha256,technical_state,lease_id,lease_expires_at)
  VALUES(p_mid,account_id,p_payload_sha256,'PROCESSING',p_lease,
         clock_timestamp()+interval '5 minutes')
  ON CONFLICT (municipality_id,citizen_account_id,payload_sha256) DO NOTHING;
  SELECT a.* INTO r FROM app.citizen_v516_traffic_attempts a
    WHERE a.municipality_id=p_mid AND a.citizen_account_id=account_id
      AND a.payload_sha256=p_payload_sha256 FOR UPDATE;

  IF r.technical_state='COMPLETE' AND
     r.completed_at>clock_timestamp()-interval '24 hours' THEN
    RETURN QUERY SELECT 'COMPLETE'::text,r.photo_id,r.photo_sha256,r.protocol_id;
    RETURN;
  END IF;
  IF r.technical_state='COMPLETE' THEN
    -- Após 24 h a mesma fotografia/dados podem gerar novo pedido legítimo.
    -- Não apagar protocolo anterior; sua chave continua na tabela canônica.
    UPDATE app.citizen_v516_traffic_attempts a
      SET technical_state='PROCESSING',lease_id=p_lease,
          lease_expires_at=clock_timestamp()+interval '5 minutes',
          photo_id=NULL,photo_sha256=NULL,protocol_id=NULL,completed_at=NULL,
          updated_at=clock_timestamp()
      WHERE a.id=r.id;
    RETURN QUERY SELECT 'NEW'::text,NULL::uuid,NULL::text,NULL::text; RETURN;
  END IF;
  IF r.lease_id IS DISTINCT FROM p_lease AND
     r.lease_expires_at>clock_timestamp() THEN
    RETURN QUERY SELECT 'BUSY'::text,NULL::uuid,NULL::text,NULL::text; RETURN;
  END IF;
  IF r.lease_id IS DISTINCT FROM p_lease THEN
    UPDATE app.citizen_v516_traffic_attempts a
      SET lease_id=p_lease,lease_expires_at=clock_timestamp()+interval '5 minutes',
          updated_at=clock_timestamp() WHERE a.id=r.id;
  END IF;
  IF r.technical_state='PHOTO_READY' THEN
    -- A sessão foi revalidada; controle de propriedade será também exigido
    -- pela função original e pelo trigger da migração 007.
    RETURN QUERY SELECT 'PHOTO_READY'::text,r.photo_id,r.photo_sha256,NULL::text;
  ELSE
    RETURN QUERY SELECT 'NEW'::text,NULL::uuid,NULL::text,NULL::text;
  END IF;
END $$;

-- Marca fotografia PRONTA somente depois de registrada pela role do scanner.
-- Verifica que a foto pertence ao mesmo titular e município e ainda não
-- foi consumida, sob locks compatíveis com o submit transacional.
CREATE FUNCTION app.citizen_v516_traffic_attempt_photo_ready(
  p_mid uuid,p_token_hash text,p_payload_sha256 text,p_lease uuid,
  p_photo_id uuid,p_photo_sha256 text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE account_id uuid; r app.citizen_v516_traffic_attempts%ROWTYPE;
BEGIN
  account_id:=app.citizen_v516_traffic_attempt_account(p_mid,p_token_hash);
  SELECT a.* INTO r FROM app.citizen_v516_traffic_attempts a
    WHERE a.municipality_id=p_mid AND a.citizen_account_id=account_id
      AND a.payload_sha256=p_payload_sha256 FOR UPDATE;
  IF NOT FOUND OR r.technical_state<>'PROCESSING' OR
     r.lease_id IS DISTINCT FROM p_lease OR
     r.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'ATTEMPT_LEASE_INVALID' USING ERRCODE='JF005';
  END IF;
  PERFORM 1 FROM app.citizen_v516_traffic_photo_owners o
    JOIN app.citizen_v516_verified_traffic_media v
      ON v.photo_id=o.photo_id AND v.municipality_id=o.municipality_id
         AND v.sha256=o.sha256 AND v.consumed_by IS NULL
    WHERE o.municipality_id=p_mid AND o.citizen_account_id=account_id
      AND o.photo_id=p_photo_id AND o.sha256=p_photo_sha256
    FOR SHARE OF o,v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VERIFIED_OWNER_PHOTO_REQUIRED' USING ERRCODE='JF004';
  END IF;
  UPDATE app.citizen_v516_traffic_attempts a
    SET technical_state='PHOTO_READY',photo_id=p_photo_id,
        photo_sha256=p_photo_sha256,updated_at=clock_timestamp()
    WHERE a.id=r.id;
END $$;

-- IMPORTANTE: chamada à função ORIGINAL e registro da idempotência
-- na MESMA transação PostgreSQL. ACK perdido após COMMIT recuperável.
CREATE FUNCTION app.citizen_v516_traffic_submit_once(
  p_mid uuid,p_token_hash text,p_payload_sha256 text,p_lease uuid,
  p_title text,p_location text,p_plate text,p_description text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE account_id uuid; r app.citizen_v516_traffic_attempts%ROWTYPE; v_protocol text;
BEGIN
  account_id:=app.citizen_v516_traffic_attempt_account(p_mid,p_token_hash);
  SELECT a.* INTO r FROM app.citizen_v516_traffic_attempts a
    WHERE a.municipality_id=p_mid AND a.citizen_account_id=account_id
      AND a.payload_sha256=p_payload_sha256 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_MISSING' USING ERRCODE='JF005';
  END IF;
  IF r.technical_state='COMPLETE' THEN
    RETURN r.protocol_id;
  END IF;
  IF r.technical_state<>'PHOTO_READY' OR
     r.lease_id IS DISTINCT FROM p_lease OR
     r.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_READY' USING ERRCODE='JF005';
  END IF;
  v_protocol:=app.citizen_v516_traffic_submit(
    p_mid,p_token_hash,NULL,NULL,NULL,NULL,
    p_title,p_location,p_plate,p_description,r.photo_id,r.photo_sha256
  );
  UPDATE app.citizen_v516_traffic_attempts a
    SET technical_state='COMPLETE',protocol_id=v_protocol,completed_at=clock_timestamp(),
        lease_id=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE a.id=r.id;
  RETURN v_protocol;
END $;

-- Observação técnica sem deletar bytes/tickets automaticamente.
-- Conciliação destrutiva depende de locks em PG + sistema de arquivos.
CREATE FUNCTION app.citizen_v516_traffic_orphan_counts()
RETURNS TABLE(expired_attempts bigint,orphan_owner_reservations bigint,
              orphan_verified_photos bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
 SELECT
 (SELECT count(*) FROM app.citizen_v516_traffic_attempts a
   WHERE a.technical_state<>'COMPLETE' AND
     a.lease_expires_at<clock_timestamp()-interval '24 hours')::bigint,
 (SELECT count(*) FROM app.citizen_v516_traffic_photo_owners o
   WHERE o.reserved_at<clock_timestamp()-interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM app.citizen_v516_traffic_protocols p
                     WHERE p.photo_id=o.photo_id))::bigint,
 (SELECT count(*) FROM app.citizen_v516_verified_traffic_media v
   WHERE v.verified_at<clock_timestamp()-interval '24 hours'
     AND v.consumed_by IS NULL)::bigint;
$$;

REVOKE ALL ON app.citizen_v516_traffic_attempts
  FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker;
REVOKE ALL ON FUNCTION
  app.citizen_v516_traffic_attempt_account(uuid,text),
  app.citizen_v516_traffic_attempt_begin(uuid,text,text,uuid),
  app.citizen_v516_traffic_attempt_photo_ready(uuid,text,text,uuid,uuid,text),
  app.citizen_v516_traffic_submit_once(uuid,text,text,uuid,text,text,text,text),
  app.citizen_v516_traffic_orphan_counts()
  FROM PUBLIC,jeriflow_v516_scan_worker;
GRANT EXECUTE ON FUNCTION
  app.citizen_v516_traffic_attempt_begin(uuid,text,text,uuid),
  app.citizen_v516_traffic_attempt_photo_ready(uuid,text,text,uuid,uuid,text),
  app.citizen_v516_traffic_submit_once(uuid,text,text,uuid,text,text,text,text)
  TO jeriflow_app;
-- Inventory deliberadamente sem grant ao aplicativo HTTP.
