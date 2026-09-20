-- Operações estreitas; não conceder CRUD direto de usuários/perfis à API.
ALTER TABLE app.identity_users ADD COLUMN registration_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN management_revision integer NOT NULL DEFAULT 1 CHECK (management_revision > 0);
ALTER TABLE app.identity_actions DROP CONSTRAINT identity_actions_purpose_check;
ALTER TABLE app.identity_actions ADD CONSTRAINT identity_actions_purpose_check
  CHECK (purpose IN ('verify-email','reset-password','complete-registration'));
ALTER TABLE app.identity_mail DROP CONSTRAINT identity_mail_purpose_check;
ALTER TABLE app.identity_mail ADD CONSTRAINT identity_mail_purpose_check
  CHECK (purpose IN ('verify-email','reset-password','password-changed','mfa-changed','recovery-used','complete-registration','access-changed'));
ALTER TABLE app.identity_audit DROP CONSTRAINT identity_audit_event_code_check;
ALTER TABLE app.identity_audit ADD CONSTRAINT identity_audit_event_code_check CHECK (event_code IN (
  'identity.provisioned','auth.login_success','auth.login_failed','auth.logout','auth.logout_all','auth.access_denied',
  'auth.email_requested','auth.email_verified','auth.reset_requested','auth.password_reset',
  'auth.mfa_enrolled','auth.mfa_success','auth.mfa_failed','auth.recovery_used','auth.recovery_rotated',
  'account.registration_requested','account.registered','account.public_joined','account.management_denied',
  'account.management_read','account.invited','account.membership_changed','account.status_changed','municipality.created'));

CREATE FUNCTION app.registration_prepare(p_email text, p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE result uuid;
BEGIN
  IF p_email IS NULL OR p_email <> lower(p_email) OR p_hash IS NULL
    OR p_hash !~ '^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
  END IF;
  INSERT INTO app.identity_users(email,display_name,password_hash,registration_pending)
    VALUES(p_email,'Cadastro pendente',p_hash,true) ON CONFLICT(email) DO NOTHING;
  SELECT id INTO result FROM app.identity_users WHERE email=p_email;
  RETURN result;
END $$;

CREATE FUNCTION app.registration_complete(p_token text, p_name text, p_hash text, p_request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE u app.identity_users; uid uuid;
BEGIN
  SELECT user_id INTO uid FROM app.identity_actions WHERE token_hash=p_token AND purpose='complete-registration';
  SELECT * INTO u FROM app.identity_users WHERE id=uid FOR UPDATE;
  IF u.id IS NULL OR NOT u.active OR NOT u.registration_pending OR u.platform_admin THEN
    RAISE EXCEPTION 'INVALID_OR_EXPIRED_TOKEN' USING ERRCODE='JF002';
  END IF;
  DELETE FROM app.identity_actions WHERE token_hash=p_token AND purpose='complete-registration'
    AND user_id=u.id AND auth_version=u.auth_version AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_OR_EXPIRED_TOKEN' USING ERRCODE='JF002'; END IF;
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120 OR p_name ~ '[[:cntrl:]]'
    OR p_hash IS NULL OR p_hash !~ '^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
  END IF;
  UPDATE app.identity_users SET display_name=trim(p_name),password_hash=p_hash,
    email_verified_at=clock_timestamp(),registration_pending=false,management_revision=management_revision+1 WHERE id=u.id;
  DELETE FROM app.identity_sessions WHERE user_id=u.id;
  DELETE FROM app.identity_actions WHERE user_id=u.id;
  DELETE FROM app.identity_mail WHERE user_id=u.id AND purpose IN ('complete-registration','verify-email','reset-password');
  INSERT INTO app.identity_audit(request_id,actor_id,target_id,event_code) VALUES(p_request,u.id,u.id,'account.registered');
  RETURN u.id;
END $$;

-- Validar sessão também dentro das funções privilegiadas; GUC actor_id não autoriza gestão.
CREATE FUNCTION app.account_actor(p_session text, p_master boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE u app.identity_users; s app.identity_sessions;
BEGIN
  SELECT * INTO u FROM app.identity_users WHERE id=(SELECT user_id FROM app.identity_sessions WHERE token_hash=p_session) FOR UPDATE;
  SELECT * INTO s FROM app.identity_sessions WHERE token_hash=p_session;
  IF u.id IS NULL OR s.user_id IS NULL OR NOT u.active OR u.registration_pending OR u.email_verified_at IS NULL
    OR s.auth_version<>u.auth_version OR s.expires_at<=clock_timestamp() OR s.last_seen_at<=clock_timestamp()-interval '15 minutes'
    OR (p_master AND (NOT u.platform_admin OR u.mfa_secret IS NULL))
    OR (u.mfa_secret IS NOT NULL AND (s.mfa_verified_at IS NULL OR s.mfa_version IS DISTINCT FROM u.mfa_version))
    OR (u.mfa_secret IS NULL AND EXISTS(SELECT 1 FROM app.memberships m JOIN app.municipalities city ON city.id=m.municipality_id
      WHERE m.user_id=u.id AND m.active AND city.active AND m.role_code LIKE 'admin-%')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003';
  END IF;
  RETURN u.id;
END $$;

CREATE FUNCTION app.public_municipalities(p_after uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)) FROM
    (SELECT id,display_name AS "displayName",slug FROM app.municipalities
      WHERE active AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT 51) m;
$$;

CREATE FUNCTION app.public_join(p_session text,p_municipality uuid,p_role text,p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE actor uuid;
BEGIN
  actor := app.account_actor(p_session,false);
  IF p_role IS NULL OR p_role NOT IN ('cidadao','turista') THEN RAISE EXCEPTION 'INVALID_PUBLIC_PROFILE' USING ERRCODE='JF001'; END IF;
  PERFORM 1 FROM app.municipalities WHERE id=p_municipality AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MUNICIPALITY_UNAVAILABLE' USING ERRCODE='JF004'; END IF;
  -- Uma suspensão prévia não pode ser desfeita por autocadastro.
  IF EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor AND municipality_id=p_municipality AND role_code=p_role AND NOT active) THEN
    RAISE EXCEPTION 'MEMBERSHIP_SUSPENDED' USING ERRCODE='JF003';
  END IF;
  INSERT INTO app.memberships(user_id,municipality_id,role_code) VALUES(actor,p_municipality,p_role) ON CONFLICT DO NOTHING;
  IF FOUND THEN
    UPDATE app.identity_users SET management_revision=management_revision+1 WHERE id=actor;
    INSERT INTO app.identity_audit(request_id,actor_id,target_id,municipality_id,event_code)
      VALUES(p_request,actor,actor,p_municipality,'account.public_joined');
  END IF;
END $$;

CREATE FUNCTION app.management_query(p_session text,p_kind text,p_after uuid,p_municipality uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM app.account_actor(p_session,true);
  IF p_kind='municipalities' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO result FROM
      (SELECT id,display_name AS "displayName",slug,active FROM app.municipalities
        WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT 51) m;
  ELSIF p_kind='accounts' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO result FROM
      (SELECT u.id,u.email,u.display_name AS "displayName",u.active,u.registration_pending AS "pending",
        u.management_revision AS revision,u.email_verified_at IS NOT NULL AS "emailVerified",
        coalesce((SELECT jsonb_agg(jsonb_build_object('municipalityId',m.municipality_id,'role',m.role_code,'active',m.active) ORDER BY m.municipality_id,m.role_code)
          FROM app.memberships m WHERE m.user_id=u.id),'[]'::jsonb) AS memberships
      FROM app.identity_users u WHERE NOT u.platform_admin AND (p_after IS NULL OR u.id>p_after)
        AND (p_municipality IS NULL OR EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=u.id AND m.municipality_id=p_municipality))
      ORDER BY u.id LIMIT 51) a;
  ELSE RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
  RETURN jsonb_build_object('items',result);
END $$;

CREATE FUNCTION app.management_mutate(p_session text,p_data jsonb,p_hash text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE actor uuid; target app.identity_users; mid uuid; roles text[]; operation text := p_data->>'operation'; changed uuid;
BEGIN
  actor := app.account_actor(p_session,true);
  IF operation='create-municipality' THEN
    INSERT INTO app.municipalities(slug,display_name) VALUES(p_data->>'slug',p_data->>'displayName')
      ON CONFLICT(slug) DO NOTHING RETURNING id INTO mid;
    IF mid IS NULL THEN RAISE EXCEPTION 'MUNICIPALITY_CONFLICT' USING ERRCODE='JF005'; END IF;
    INSERT INTO app.identity_audit(request_id,actor_id,municipality_id,event_code) VALUES(p_request,actor,mid,'municipality.created');
    RETURN jsonb_build_object('municipalityId',mid);
  END IF;
  IF operation NOT IN ('invite','set-membership','set-active') OR operation IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
  END IF;
  IF operation IN ('invite','set-membership') THEN
    mid := (p_data->>'municipalityId')::uuid;
    PERFORM 1 FROM app.municipalities WHERE id=mid AND active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MUNICIPALITY_UNAVAILABLE' USING ERRCODE='JF004'; END IF;
    SELECT array_agg(value) INTO roles FROM jsonb_array_elements_text(p_data->'roles');
    roles := coalesce(roles,ARRAY[]::text[]);
    IF NOT (roles <@ ARRAY['cidadao','turista','guarda','fiscal-tts','admin-turismo','admin-cidadao','admin-semus','admin-conteudo','admin-dashboard','admin-studio','admin-tts']::text[])
      OR cardinality(roles)>11 OR (operation='invite' AND cardinality(roles)=0) THEN
      RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
    END IF;
  END IF;
  IF operation='invite' THEN
    -- Não alterar contas existentes silenciosamente por email: use ID + revisão.
    IF EXISTS(SELECT 1 FROM app.identity_users WHERE email=p_data->>'email') THEN
      RAISE EXCEPTION 'ACCOUNT_EXISTS_USE_MANAGEMENT' USING ERRCODE='JF005';
    END IF;
    IF p_hash IS NULL OR p_hash !~ '^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
    END IF;
    INSERT INTO app.identity_users(email,display_name,password_hash,registration_pending)
      VALUES(p_data->>'email','Cadastro pendente',p_hash,true) ON CONFLICT(email) DO NOTHING RETURNING id INTO changed;
    IF changed IS NULL THEN RAISE EXCEPTION 'ACCOUNT_EXISTS_USE_MANAGEMENT' USING ERRCODE='JF005'; END IF;
    SELECT * INTO target FROM app.identity_users WHERE id=changed FOR UPDATE;
    -- Uma criação concorrente não pode ser convertida em convite.
    IF NOT target.registration_pending OR target.platform_admin OR EXISTS(SELECT 1 FROM app.memberships WHERE user_id=target.id) THEN
      RAISE EXCEPTION 'ACCOUNT_EXISTS_USE_MANAGEMENT' USING ERRCODE='JF005';
    END IF;
  ELSE
    SELECT * INTO target FROM app.identity_users WHERE id=(p_data->>'userId')::uuid FOR UPDATE;
    IF target.id IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE='JF004'; END IF;
    IF target.platform_admin OR target.id=actor THEN RAISE EXCEPTION 'PROTECTED_ACCOUNT' USING ERRCODE='JF003'; END IF;
    IF p_data->>'revision' IS NULL OR target.management_revision<>(p_data->>'revision')::integer THEN RAISE EXCEPTION 'STALE_REVISION' USING ERRCODE='JF005'; END IF;
  END IF;
  IF operation='set-active' THEN
    IF jsonb_typeof(p_data->'active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
    UPDATE app.identity_users SET active=(p_data->>'active')::boolean,management_revision=management_revision+1 WHERE id=target.id;
  ELSE
    -- Reter vínculos inativos impede que o cidadão desfaça bloqueios por autocadastro.
    UPDATE app.memberships SET active=false WHERE user_id=target.id AND municipality_id=mid;
    INSERT INTO app.memberships(user_id,municipality_id,role_code,active)
      SELECT target.id,mid,unnest(roles),true ON CONFLICT(user_id,municipality_id,role_code) DO UPDATE SET active=true;
    UPDATE app.identity_users SET auth_version=auth_version+1,management_revision=management_revision+1 WHERE id=target.id;
  END IF;
  DELETE FROM app.identity_sessions WHERE user_id=target.id;
  DELETE FROM app.identity_actions WHERE user_id=target.id;
  DELETE FROM app.identity_mail WHERE user_id=target.id AND purpose IN ('verify-email','reset-password','complete-registration');
  INSERT INTO app.identity_audit(request_id,actor_id,target_id,municipality_id,event_code)
    VALUES(p_request,actor,target.id,mid,CASE operation WHEN 'invite' THEN 'account.invited' WHEN 'set-active' THEN 'account.status_changed' ELSE 'account.membership_changed' END);
  RETURN jsonb_build_object('userId',target.id,'revision',(SELECT management_revision FROM app.identity_users WHERE id=target.id));
END $$;

REVOKE ALL ON FUNCTION app.registration_prepare(text,text),app.registration_complete(text,text,text,uuid),
  app.account_actor(text,boolean),app.public_municipalities(uuid),app.public_join(text,uuid,text,uuid),
  app.management_query(text,text,uuid,uuid),app.management_mutate(text,jsonb,text,uuid) FROM PUBLIC;
-- account_actor é auxiliar privado; somente as operações delimitadas são expostas.
GRANT EXECUTE ON FUNCTION app.registration_prepare(text,text),app.registration_complete(text,text,text,uuid),
  app.public_municipalities(uuid),app.public_join(text,uuid,text,uuid),
  app.management_query(text,text,uuid,uuid),app.management_mutate(text,jsonb,text,uuid) TO jeriflow_app;
