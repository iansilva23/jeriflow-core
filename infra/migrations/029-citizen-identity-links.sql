-- A conta de identidade e a conta Cidadão existente precisam comprovar posse.
CREATE TABLE app.citizen_v516_identity_links (
  user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
  citizen_account_id uuid NOT NULL UNIQUE REFERENCES app.citizen_v516_accounts(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id,municipality_id)
);
REVOKE ALL ON app.citizen_v516_identity_links FROM PUBLIC,jeriflow_app;

CREATE FUNCTION app.citizen_v516_link_identity(p_mid uuid,p_identity_hash text,p_citizen_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; target uuid;
BEGIN
  actor := app.account_actor(p_identity_hash,false);
  PERFORM 1 FROM app.memberships m JOIN app.municipalities city ON city.id=m.municipality_id
    WHERE m.user_id=actor AND m.municipality_id=p_mid AND m.role_code='cidadao'
    AND m.active AND city.active FOR SHARE OF m,city;
  IF NOT FOUND THEN RAISE EXCEPTION 'CITIZEN_FORBIDDEN' USING ERRCODE='JF003'; END IF;

  SELECT a.id INTO target FROM app.citizen_v516_sessions s
    JOIN app.citizen_v516_accounts a ON a.id=s.account_id AND a.municipality_id=s.municipality_id
    WHERE s.token_hash=p_citizen_hash AND s.municipality_id=p_mid AND a.active
    AND s.expires_at>clock_timestamp() AND s.last_seen_at>clock_timestamp()-interval '15 minutes'
    AND NOT (a.moderation_status='BANNED' OR
      (a.moderation_status='SUSPENDED' AND (a.suspended_until IS NULL OR a.suspended_until>clock_timestamp())))
    FOR UPDATE OF a FOR SHARE OF s;
  IF target IS NULL THEN RAISE EXCEPTION 'CITIZEN_FORBIDDEN' USING ERRCODE='JF003'; END IF;

  INSERT INTO app.citizen_v516_identity_links(user_id,municipality_id,citizen_account_id)
    VALUES(actor,p_mid,target) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM app.citizen_v516_identity_links
    WHERE user_id=actor AND municipality_id=p_mid AND citizen_account_id=target) THEN
    RAISE EXCEPTION 'CITIZEN_LINK_CONFLICT' USING ERRCODE='JF005';
  END IF;
END $$;
REVOKE ALL ON FUNCTION app.citizen_v516_link_identity(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.citizen_v516_link_identity(uuid,text,text) TO jeriflow_app;

CREATE OR REPLACE FUNCTION app.citizen_v516_resolve(p_mid uuid,p_hash text)
RETURNS TABLE(
  "municipalityId" text,"citizenId" text,name text,
  "birthDate" text,phone text,address text,login text,active boolean,blocked boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE citizen app.citizen_v516_accounts%ROWTYPE; actor uuid;
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
  IF citizen.id IS NULL THEN
    BEGIN
      actor := app.account_actor(p_hash,false);
    EXCEPTION WHEN SQLSTATE 'JF003' THEN
      RETURN;
    END;
    PERFORM 1 FROM app.memberships m JOIN app.municipalities city ON city.id=m.municipality_id
      WHERE m.user_id=actor AND m.municipality_id=p_mid AND m.role_code='cidadao'
      AND m.active AND city.active FOR SHARE OF m,city;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT a.* INTO citizen FROM app.citizen_v516_identity_links l
      JOIN app.citizen_v516_accounts a ON a.id=l.citizen_account_id AND a.municipality_id=l.municipality_id
      WHERE l.user_id=actor AND l.municipality_id=p_mid AND a.active
      FOR UPDATE OF a;
    IF citizen.id IS NULL THEN RETURN; END IF;
  ELSE
    UPDATE app.citizen_v516_sessions SET last_seen_at=clock_timestamp()
      WHERE token_hash=p_hash AND account_id=citizen.id AND municipality_id=p_mid
        AND expires_at>clock_timestamp()
        AND last_seen_at>clock_timestamp()-interval '15 minutes';
    IF NOT FOUND THEN RETURN; END IF;
  END IF;
  RETURN QUERY SELECT citizen.municipality_id::text,citizen.citizen_id,citizen.name,
    citizen.birth_date::text,citizen.phone,citizen.address,citizen.login,
    citizen.active,
    (citizen.moderation_status='BANNED' OR
      (citizen.moderation_status='SUSPENDED' AND
        (citizen.suspended_until IS NULL OR citizen.suspended_until>clock_timestamp())));
END $$;

