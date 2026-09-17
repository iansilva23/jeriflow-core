-- Somente o banco local recém-criado. O usuário da API não é o administrador.
\set ON_ERROR_STOP on
REVOKE ALL ON DATABASE jeriflow_dev FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $$
DECLARE
  app_secret text;
BEGIN
  -- trim(text) remove espaços, mas NÃO a quebra de linha do arquivo de secret.
  -- Aceitar LF/CRLF nas bordas e validar o formato gerado antes de criar o papel.
  app_secret := btrim(pg_read_file('/run/secrets/postgres_app_password'), E'\r\n');
  IF app_secret !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid local application secret format';
  END IF;
  EXECUTE format(
    'CREATE ROLE jeriflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
    app_secret
  );
END
$$;
GRANT CONNECT, TEMPORARY ON DATABASE jeriflow_dev TO jeriflow_app;
CREATE SCHEMA app AUTHORIZATION jeriflow_owner;
GRANT USAGE ON SCHEMA app TO jeriflow_app;
ALTER ROLE jeriflow_app IN DATABASE jeriflow_dev SET search_path = app;
ALTER DEFAULT PRIVILEGES FOR ROLE jeriflow_owner IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jeriflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE jeriflow_owner IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO jeriflow_app;
-- Tabelas de negócio e políticas por município/perfil pertencem à etapa do backend.
