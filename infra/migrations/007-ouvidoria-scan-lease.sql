-- Scanner ClamAV fail-closed: estado de processamento e leasing transacional.
-- Não altera migrações anteriores, bytes privados ou permissão do usuário API.
ALTER TABLE app.ouvidoria_attachments
  DROP CONSTRAINT IF EXISTS ouvidoria_attachments_scan_status_check;
ALTER TABLE app.ouvidoria_attachments
  ADD CONSTRAINT ouvidoria_attachments_scan_status_check
  CHECK (scan_status IN ('quarantined','scanning','rejected','clean'));
ALTER TABLE app.ouvidoria_attachments
  ADD COLUMN scan_attempts integer NOT NULL DEFAULT 0 CHECK(scan_attempts BETWEEN 0 AND 3),
  ADD COLUMN scan_started_at timestamptz,
  ADD COLUMN scan_lease uuid,
  ADD CONSTRAINT ouvidoria_scan_lease_consistent CHECK (
    (scan_status='scanning' AND scan_started_at IS NOT NULL AND scan_lease IS NOT NULL)
    OR (scan_status<>'scanning' AND scan_started_at IS NULL AND scan_lease IS NULL)
  );
CREATE INDEX ouvidoria_attachment_scan_idx ON app.ouvidoria_attachments(scan_status,created_at,id);
CREATE TABLE app.ouvidoria_attachment_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES app.ouvidoria_attachments(id),
  result text NOT NULL CHECK(result IN ('clean','rejected','retry')),
  scanner_version text NOT NULL CHECK(length(scanner_version) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON app.ouvidoria_attachment_scan_events FROM PUBLIC, jeriflow_app;
-- Somente o worker local com conta proprietária administra o scanner.
-- O papel de API continua sem acesso de escrita às tabelas.
