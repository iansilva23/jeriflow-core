CREATE TABLE app.identity_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  password_hash text NOT NULL CHECK (length(password_hash) < 512),
  active boolean NOT NULL DEFAULT true,
  platform_admin boolean NOT NULL DEFAULT false,
  auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.municipalities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.memberships (
  user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE CASCADE,
  role_code text NOT NULL CHECK (role_code IN ('cidadao','turista','guarda','fiscal-tts',
    'admin-turismo','admin-cidadao','admin-semus','admin-conteudo','admin-dashboard','admin-studio','admin-tts')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(user_id, municipality_id, role_code)
);
CREATE INDEX memberships_municipality_idx ON app.memberships (municipality_id, user_id);
CREATE TABLE app.identity_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE CASCADE,
  auth_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '8 hours'),
  CHECK (expires_at > created_at)
);
CREATE INDEX identity_sessions_user_idx ON app.identity_sessions(user_id, created_at);
CREATE INDEX identity_sessions_expiry_idx ON app.identity_sessions(expires_at);
CREATE TABLE app.identity_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_id uuid NOT NULL,
  actor_id uuid,
  target_id uuid,
  municipality_id uuid,
  event_code text NOT NULL CHECK (event_code IN ('identity.provisioned', 'auth.login_success',
    'auth.login_failed', 'auth.logout', 'auth.logout_all', 'auth.access_denied'))
);
CREATE INDEX identity_audit_actor_time_idx ON app.identity_audit(actor_id, created_at);
CREATE FUNCTION app.invalidate_identity_sessions() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, app AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.active IS DISTINCT FROM OLD.active THEN
    NEW.auth_version := OLD.auth_version + 1;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER identity_credentials_changed BEFORE UPDATE ON app.identity_users
  FOR EACH ROW EXECUTE FUNCTION app.invalidate_identity_sessions();
REVOKE ALL ON FUNCTION app.invalidate_identity_sessions() FROM PUBLIC;

-- Políticas por usuário são aplicadas após validar a sessão. Contexto ausente nega tudo.
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY own_memberships ON app.memberships FOR SELECT TO jeriflow_app
  USING (active AND user_id = nullif(current_setting('app.actor_id', true), '')::uuid);
ALTER TABLE app.municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.municipalities FORCE ROW LEVEL SECURITY;
CREATE POLICY own_municipalities ON app.municipalities FOR SELECT TO jeriflow_app
  USING (active AND EXISTS (SELECT 1 FROM app.memberships m WHERE m.municipality_id = municipalities.id));

-- Revogar o CRUD herdado dos defaults da base. A API não provisiona privilégios.
REVOKE ALL ON app.identity_users, app.municipalities, app.memberships,
  app.identity_sessions, app.identity_audit FROM PUBLIC, jeriflow_app;
GRANT SELECT ON app.identity_users, app.municipalities, app.memberships TO jeriflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.identity_sessions TO jeriflow_app;
GRANT INSERT ON app.identity_audit TO jeriflow_app;
