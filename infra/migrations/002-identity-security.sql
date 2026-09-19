-- Migração aditiva: usuários existentes também precisam comprovar o email.
ALTER TABLE app.identity_users
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN mfa_secret text CHECK (length(mfa_secret) < 512),
  ADD COLUMN mfa_version integer NOT NULL DEFAULT 0 CHECK (mfa_version >= 0),
  ADD COLUMN mfa_last_step bigint NOT NULL DEFAULT -1;
ALTER TABLE app.identity_sessions
  ADD COLUMN mfa_version integer,
  ADD COLUMN mfa_verified_at timestamptz;
CREATE OR REPLACE FUNCTION app.invalidate_identity_sessions() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, app AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN NEW.email_verified_at := NULL; END IF;
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.active IS DISTINCT FROM OLD.active
    OR NEW.email IS DISTINCT FROM OLD.email OR NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at THEN
    NEW.auth_version := OLD.auth_version + 1;
  END IF;
  RETURN NEW;
END
$$;
CREATE TABLE app.identity_keys (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$')
);
CREATE TABLE app.identity_actions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify-email','reset-password')),
  auth_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE(user_id, purpose)
);
CREATE TABLE app.identity_mfa_pending (
  user_id uuid PRIMARY KEY REFERENCES app.identity_users(id) ON DELETE CASCADE,
  session_hash text NOT NULL REFERENCES app.identity_sessions(token_hash) ON DELETE CASCADE,
  secret text NOT NULL CHECK (length(secret) < 512),
  expires_at timestamptz NOT NULL
);
CREATE TABLE app.identity_recovery_codes (
  user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(user_id, code_hash)
);
CREATE TABLE app.identity_mail (
  user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify-email','reset-password','password-changed','mfa-changed','recovery-used')),
  payload text NOT NULL CHECK (length(payload) < 16384),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(user_id, purpose)
);
ALTER TABLE app.identity_audit DROP CONSTRAINT identity_audit_event_code_check;
ALTER TABLE app.identity_audit ADD CONSTRAINT identity_audit_event_code_check CHECK (event_code IN (
  'identity.provisioned','auth.login_success','auth.login_failed','auth.logout','auth.logout_all','auth.access_denied',
  'auth.email_requested','auth.email_verified','auth.reset_requested','auth.password_reset',
  'auth.mfa_enrolled','auth.mfa_success','auth.mfa_failed','auth.recovery_used','auth.recovery_rotated'));
REVOKE ALL ON app.identity_keys, app.identity_actions, app.identity_mfa_pending,
  app.identity_recovery_codes, app.identity_mail FROM PUBLIC, jeriflow_app;
GRANT SELECT ON app.identity_keys TO jeriflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.identity_actions, app.identity_mfa_pending,
  app.identity_recovery_codes, app.identity_mail TO jeriflow_app;
GRANT UPDATE (password_hash, email_verified_at, mfa_secret, mfa_version, mfa_last_step) ON app.identity_users TO jeriflow_app;
