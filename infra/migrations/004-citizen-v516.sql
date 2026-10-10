-- V5.16 citizen-only registration, independent of the email-first generic identity model.
-- Source: cidadao-ai/index.html citizenSignup(), citizenLogin(), currentCitizen();
-- SHA-256 original ZIP: 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- Additive only; not applied to production by this PR.
CREATE TABLE app.citizen_v516_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  citizen_id text GENERATED ALWAYS AS ('CID-' || lpad(citizen_number::text,8,'0')) STORED UNIQUE,
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  birth_date date NOT NULL,
  phone text NOT NULL CHECK (length(trim(phone)) BETWEEN 1 AND 100),
  address text NOT NULL CHECK (length(trim(address)) BETWEEN 1 AND 300),
  login text NOT NULL CHECK (login ~ '^[a-z0-9._-]{1,64}$'),
  password_hash text NOT NULL CHECK (password_hash ~ '^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$'),
  active boolean NOT NULL DEFAULT true,
  moderation_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (moderation_status IN ('ACTIVE','WARNING','SUSPENDED','BANNED')),
  suspended_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(municipality_id,login)
);
CREATE INDEX citizen_v516_phone_moderation_idx ON app.citizen_v516_accounts
  (municipality_id, (regexp_replace(lower(phone),'[^a-z0-9]','','g')))
  WHERE moderation_status IN ('BANNED','SUSPENDED');
CREATE TABLE app.citizen_v516_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  account_id uuid NOT NULL REFERENCES app.citizen_v516_accounts(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '8 hours'),
  CHECK (expires_at > created_at)
);
CREATE INDEX citizen_v516_sessions_account_idx ON app.citizen_v516_sessions(account_id);

-- Only server-side SECURITY DEFINER functions can touch citizen records.
-- An API token is stored ONLY as a SHA-256 digest, never as plaintext.
CREATE FUNCTION app.citizen_v516_register(
  p_mid uuid,p_name text,p_birth date,p_phone text,p_address text,
  p_login text,p_hash text
) RETURNS TABLE(account_id uuid,citizen_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF p_mid IS NULL OR p_name IS NULL OR p_birth IS NULL OR p_phone IS NULL
    OR p_address IS NULL OR p_login IS NULL OR p_hash IS NULL
    OR length(trim(p_name)) NOT BETWEEN 1 AND 120
    OR length(trim(p_phone)) NOT BETWEEN 1 AND 100
    OR length(trim(p_address)) NOT BETWEEN 1 AND 300
    OR p_login !~ '^[a-z0-9._-]{1,64}$'
    OR p_hash !~ '^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'INVALID_CITIZEN_INPUT' USING ERRCODE='JF001'; END IF;
  PERFORM 1 FROM app.municipalities WHERE id=p_mid AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MUNICIPALITY_UNAVAILABLE' USING ERRCODE='JF004'; END IF;
  -- V5.16: preexisting citizen moderation by login OR phone blocks self-registration.
  IF EXISTS (
    SELECT 1 FROM app.citizen_v516_accounts a
    WHERE a.municipality_id=p_mid
      AND (a.login=p_login OR regexp_replace(lower(a.phone),'[^a-z0-9]','','g')
        =regexp_replace(lower(p_phone),'[^a-z0-9]','','g'))
      AND (a.moderation_status='BANNED' OR
        (a.moderation_status='SUSPENDED' AND
          (a.suspended_until IS NULL OR a.suspended_until>clock_timestamp())))
  ) THEN RAISE EXCEPTION 'CITIZEN_MODERATION_BLOCKED' USING ERRCODE='JF003'; END IF;
  RETURN QUERY
    INSERT INTO app.citizen_v516_accounts
      (municipality_id,name,birth_date,phone,address,login,password_hash)
    VALUES(p_mid,trim(p_name),p_birth,trim(p_phone),trim(p_address),p_login,p_hash)
    RETURNING id,app.citizen_v516_accounts.citizen_id;
END $$;

CREATE FUNCTION app.citizen_v516_credential(p_mid uuid,p_login text)
RETURNS TABLE(account_id uuid,password_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
  SELECT a.id,a.password_hash FROM app.citizen_v516_accounts a
  JOIN app.municipalities m ON m.id=a.municipality_id AND m.active
  WHERE a.municipality_id=p_mid AND a.login=p_login AND a.active;
$$;

-- Only invoke following a VERIFIED scrypt check inside the trusted backend.
-- Never expose this low-level function to user-provided SQL or direct clients.
CREATE FUNCTION app.citizen_v516_issue(p_mid uuid,p_account uuid,p_hash text,p_verified_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_SESSION' USING ERRCODE='JF001'; END IF;
  PERFORM 1 FROM app.citizen_v516_accounts a
    JOIN app.municipalities m ON m.id=a.municipality_id
    WHERE a.id=p_account AND a.municipality_id=p_mid AND a.password_hash=p_verified_hash
      AND a.active AND m.active
      AND NOT (a.moderation_status='BANNED' OR
        (a.moderation_status='SUSPENDED' AND
          (a.suspended_until IS NULL OR a.suspended_until>clock_timestamp())))
    FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'CITIZEN_FORBIDDEN' USING ERRCODE='JF003'; END IF;
  INSERT INTO app.citizen_v516_sessions(token_hash,account_id,municipality_id)
    VALUES (p_hash,p_account,p_mid);
END $$;

CREATE FUNCTION app.citizen_v516_resolve(p_mid uuid,p_hash text)
RETURNS TABLE(
  "municipalityId" text,"citizenId" text,name text,
  "birthDate" text,phone text,address text,login text,active boolean,blocked boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE citizen app.citizen_v516_accounts%ROWTYPE;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RETURN; END IF;
  SELECT a.* INTO citizen FROM app.citizen_v516_sessions s
    JOIN app.citizen_v516_accounts a ON a.id=s.account_id
    JOIN app.municipalities m ON m.id=a.municipality_id
    WHERE s.token_hash=p_hash AND s.municipality_id=p_mid
      AND a.municipality_id=p_mid AND a.active AND m.active
      AND s.expires_at>clock_timestamp()
      AND s.last_seen_at>clock_timestamp()-interval '15 minutes'
    FOR UPDATE OF a;
  IF citizen.id IS NULL THEN RETURN; END IF;
  UPDATE app.citizen_v516_sessions SET last_seen_at=clock_timestamp()
    WHERE token_hash=p_hash AND account_id=citizen.id AND municipality_id=p_mid
      AND expires_at>clock_timestamp()
      AND last_seen_at>clock_timestamp()-interval '15 minutes';
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT citizen.municipality_id::text,citizen.citizen_id,citizen.name,
    citizen.birth_date::text,citizen.phone,citizen.address,citizen.login,
    citizen.active,
    (citizen.moderation_status='BANNED' OR
      (citizen.moderation_status='SUSPENDED' AND
        (citizen.suspended_until IS NULL OR citizen.suspended_until>clock_timestamp())));
END $$;

CREATE FUNCTION app.citizen_v516_logout(p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RETURN; END IF;
  DELETE FROM app.citizen_v516_sessions WHERE token_hash=p_hash;
END $$;

REVOKE ALL ON app.citizen_v516_accounts,app.citizen_v516_sessions FROM PUBLIC,jeriflow_app;
REVOKE ALL ON SEQUENCE app.citizen_v516_accounts_citizen_number_seq FROM PUBLIC,jeriflow_app;
REVOKE ALL ON FUNCTION
  app.citizen_v516_register(uuid,text,date,text,text,text,text),
  app.citizen_v516_credential(uuid,text),
  app.citizen_v516_issue(uuid,uuid,text,text),
  app.citizen_v516_resolve(uuid,text),
  app.citizen_v516_logout(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.citizen_v516_register(uuid,text,date,text,text,text,text),
  app.citizen_v516_credential(uuid,text),
  app.citizen_v516_issue(uuid,uuid,text,text),
  app.citizen_v516_resolve(uuid,text),
  app.citizen_v516_logout(text) TO jeriflow_app;
