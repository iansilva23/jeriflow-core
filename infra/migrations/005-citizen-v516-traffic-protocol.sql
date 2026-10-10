-- V5.16: protocolo CANÔNICO do Cidadão, compartilhado por Guarda / ADM SEMUS.
-- HTML: cidadao-ai/index.html submitTrafficForm(), makeProtocolId();
-- guarda-semus/index.html allTraffic()/acceptReport(); admin-semus/index.html reopen()/closeAdmin().
-- SHA ZIP: 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- Importante: NÃO existe função que aprove imagem por booleano fornecido pelo cliente.

CREATE SEQUENCE app.citizen_v516_traffic_seq AS bigint START WITH 1;
-- Gate privado: só o FUTURO worker antimalware autorizado pode registrar
-- uma fotografia após verificação real de bytes/sha/armazenamento. A API não pode.
CREATE TABLE app.citizen_v516_verified_traffic_media (
  photo_id uuid PRIMARY KEY,
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  normalized_mime text NOT NULL DEFAULT 'image/webp' CHECK (normalized_mime = 'image/webp'),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consumed_by text,
  UNIQUE (municipality_id,photo_id)
);
CREATE TABLE app.citizen_v516_traffic_protocols (
  id text PRIMARY KEY CHECK (id ~ '^JF-[0-9]{8}-[0-9]{6,}$'),
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
  citizen_account_id uuid REFERENCES app.citizen_v516_accounts(id) ON DELETE RESTRICT,
  guest_device_hash text CHECK (guest_device_hash ~ '^[a-f0-9]{64}$'),
  identity_name text NOT NULL,
  identity_birth_date date,
  identity_phone text NOT NULL,
  identity_address text NOT NULL DEFAULT '',
  identity_login text NOT NULL DEFAULT '',
  title text NOT NULL CHECK (title IN (
    'Estacionamento irregular',
    'Veículo bloqueando acesso/garagem',
    'Veículo em área proibida',
    'Via parcialmente bloqueada',
    'Circulação irregular',
    'Transporte irregular',
    'Outro problema de trânsito'
  )),
  category text NOT NULL DEFAULT 'Trânsito (SEMUS)'
    CHECK (category='Trânsito (SEMUS)'),
  destination text NOT NULL DEFAULT 'SEMUS / Guarda de trânsito'
    CHECK (destination='SEMUS / Guarda de trânsito'),
  status text NOT NULL DEFAULT 'RECEBIDA'
    CHECK(status IN ('RECEBIDA','EM ATENDIMENTO','FINALIZADA')),
  location text NOT NULL CHECK(length(trim(location))>0),
  plate text NOT NULL DEFAULT '' CHECK(length(plate)<=8),
  description text NOT NULL CHECK(length(trim(description))>0),
  has_photo boolean NOT NULL DEFAULT true CHECK(has_photo),
  photo_id uuid NOT NULL UNIQUE,
  photo_sha256 text NOT NULL CHECK(photo_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((citizen_account_id IS NOT NULL AND guest_device_hash IS NULL)
      OR (citizen_account_id IS NULL AND guest_device_hash IS NOT NULL)),
  FOREIGN KEY (municipality_id,photo_id)
    REFERENCES app.citizen_v516_verified_traffic_media(municipality_id,photo_id)
    ON DELETE RESTRICT
);
ALTER TABLE app.citizen_v516_verified_traffic_media
  ADD CONSTRAINT traffic_v516_consumed_by_fk
  FOREIGN KEY (consumed_by) REFERENCES app.citizen_v516_traffic_protocols(id) ON DELETE RESTRICT;
CREATE INDEX citizen_v516_traffic_queue_idx
  ON app.citizen_v516_traffic_protocols(municipality_id,status,created_at DESC);

CREATE FUNCTION app.citizen_v516_traffic_submit(
  p_mid uuid,p_token_hash text,p_guest_device_hash text,
  p_name text,p_birth date,p_phone text,
  p_title text,p_location text,p_plate text,p_description text,
  p_photo_id uuid,p_photo_sha text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE
  owner_info record;
  media app.citizen_v516_verified_traffic_media%ROWTYPE;
  account uuid;
  final_name text;
  final_birth date;
  final_phone text;
  final_address text:='';
  final_login text:='';
  new_id text;
BEGIN
  IF p_mid IS NULL OR p_title IS NULL OR p_location IS NULL
    OR p_description IS NULL OR p_photo_id IS NULL OR p_photo_sha IS NULL
    OR length(trim(p_location))=0 OR length(trim(p_description))=0
    OR length(coalesce(p_plate,''))>8
    OR p_title NOT IN (
      'Estacionamento irregular','Veículo bloqueando acesso/garagem',
      'Veículo em área proibida','Via parcialmente bloqueada',
      'Circulação irregular','Transporte irregular','Outro problema de trânsito'
    )
    OR p_photo_sha !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'INVALID_TRAFFIC_DRAFT' USING ERRCODE='JF001'; END IF;
  -- O Cidadão logado e o visitante identificado são caminhos EXCLUSIVOS.
  IF p_token_hash IS NOT NULL AND p_guest_device_hash IS NULL THEN
    SELECT * INTO owner_info FROM app.citizen_v516_resolve(p_mid,p_token_hash);
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CITIZEN_SESSION' USING ERRCODE='JF003'; END IF;
    IF owner_info.blocked THEN RAISE EXCEPTION 'CITIZEN_MODERATION_BLOCKED' USING ERRCODE='JF003'; END IF;
    SELECT a.id INTO account FROM app.citizen_v516_accounts a
      WHERE a.municipality_id=p_mid AND a.citizen_id=owner_info."citizenId" AND a.active
      FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CITIZEN_SESSION' USING ERRCODE='JF003'; END IF;
    final_name:=owner_info.name;
    final_birth:=owner_info."birthDate"::date;
    final_phone:=owner_info.phone;
    final_address:=owner_info.address;
    final_login:=owner_info.login;
  ELSIF p_token_hash IS NULL AND p_guest_device_hash ~ '^[a-f0-9]{64}$' THEN
    IF p_name IS NULL OR length(trim(p_name))=0 OR p_birth IS NULL OR
      p_phone IS NULL OR length(trim(p_phone))=0 THEN
      RAISE EXCEPTION 'IDENTITY_REQUIRED' USING ERRCODE='JF001'; END IF;
    final_name:=trim(p_name);
    final_birth:=p_birth;
    final_phone:=trim(p_phone);
  ELSE
    RAISE EXCEPTION 'IDENTITY_REQUIRED' USING ERRCODE='JF001';
  END IF;

  -- Consume exactly one media entry created by a trusted scan worker.
  SELECT * INTO media FROM app.citizen_v516_verified_traffic_media
    WHERE municipality_id=p_mid AND photo_id=p_photo_id
      AND sha256=p_photo_sha AND consumed_by IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFIED_PHOTO_REQUIRED' USING ERRCODE='JF004'; END IF;

  new_id:='JF-'||to_char(clock_timestamp() AT TIME ZONE 'America/Fortaleza','YYYYMMDD')
    ||'-'||lpad(nextval('app.citizen_v516_traffic_seq')::text,6,'0');
  INSERT INTO app.citizen_v516_traffic_protocols(
    id,municipality_id,citizen_account_id,guest_device_hash,identity_name,
    identity_birth_date,identity_phone,identity_address,identity_login,
    title,location,plate,description,photo_id,photo_sha256
  ) VALUES (
    new_id,p_mid,account,p_guest_device_hash,final_name,final_birth,final_phone,
    final_address,final_login,p_title,trim(p_location),upper(trim(coalesce(p_plate,''))),
    trim(p_description),p_photo_id,p_photo_sha
  );
  UPDATE app.citizen_v516_verified_traffic_media
    SET consumed_by=new_id WHERE photo_id=p_photo_id AND consumed_by IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHOTO_ALREADY_BOUND' USING ERRCODE='JF005'; END IF;
  RETURN new_id;
END $$;

-- A role API NÃO insere evidência verificada, NÃO lê PII diretamente,
-- NÃO apaga protocolos e NÃO gera novos estados da Guarda fora da V5.16.
REVOKE ALL ON app.citizen_v516_verified_traffic_media,
  app.citizen_v516_traffic_protocols FROM PUBLIC,jeriflow_app;
REVOKE ALL ON SEQUENCE app.citizen_v516_traffic_seq FROM PUBLIC,jeriflow_app;
REVOKE ALL ON FUNCTION app.citizen_v516_traffic_submit(
  uuid,text,text,text,date,text,text,text,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.citizen_v516_traffic_submit(
  uuid,text,text,text,date,text,text,text,text,text,uuid,text) TO jeriflow_app;
