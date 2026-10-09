-- ADM Ouvidoria: visão integral de TODAS as categorias, inclusive denúncias.
-- Manter autenticação/MFA, vínculo municipal, auditoria e bloqueio antivírus dos bytes.
-- Migração aditiva: sem alterar as migrações validadas nem copiar descrições sensíveis.
CREATE TABLE app.ouvidoria_admin_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
  actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
  protocol_id uuid REFERENCES app.ouvidoria_protocols(id),
  action text NOT NULL CHECK(action IN ('queue','history','attachments')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ouvidoria_admin_access_tenant_idx
  ON app.ouvidoria_admin_access_events(municipality_id,actor_user_id,created_at);
REVOKE ALL ON app.ouvidoria_admin_access_events FROM PUBLIC,jeriflow_app,jeriflow_scanner;
-- admin-cidadao continua autorizado a todas as categorias no seu município.
-- O corpo da denúncia não é duplicado na trilha de auditoria.
CREATE OR REPLACE FUNCTION app.ouvidoria_query(p_session text, p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE actor uuid; mid uuid; scope text; after_id uuid;
BEGIN
  actor := app.account_actor(p_session,false);
  mid := (p_data->>'municipalityId')::uuid;
  scope := p_data->>'scope';
  after_id := nullif(p_data->>'after','')::uuid;
  IF scope NOT IN ('meus','fila') OR scope IS NULL OR mid IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
  END IF;
  PERFORM 1 FROM app.municipalities WHERE id=mid AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
  PERFORM 1 FROM app.memberships
    WHERE user_id=actor AND municipality_id=mid AND active
      AND role_code=CASE scope WHEN 'meus' THEN 'cidadao' ELSE 'admin-cidadao' END;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
  IF scope='fila' THEN
    INSERT INTO app.ouvidoria_admin_access_events(municipality_id,actor_user_id,action)
      VALUES(mid,actor,'queue');
  END IF;
  RETURN jsonb_build_object('items',(
    SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) FROM (
      SELECT p.id,p.municipality_id AS "municipalityId",p.category,p.title,p.description,
        p.status,p.response,p.contest_note AS "contestNote",p.contest_count AS "contestCount",
        p.revision,p.created_at AS "createdAt",p.updated_at AS "updatedAt"
      FROM app.ouvidoria_protocols p WHERE p.municipality_id=mid
        AND (scope='fila' OR p.author_user_id=actor)
        AND (after_id IS NULL OR p.id>after_id)
      ORDER BY p.id LIMIT 21
    ) q
  ));
END $$;

CREATE OR REPLACE FUNCTION app.ouvidoria_history(p_session text,p_municipality uuid,p_protocol uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; author uuid; can_read boolean;
BEGIN
  actor := app.account_actor(p_session,false);
  SELECT p.author_user_id INTO author
    FROM app.ouvidoria_protocols p JOIN app.municipalities m
      ON m.id=p.municipality_id AND m.active
    WHERE p.id=p_protocol AND p.municipality_id=p_municipality;
  IF author IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004';
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM app.memberships mem WHERE mem.user_id=actor
      AND mem.municipality_id=p_municipality AND mem.active
      AND (mem.role_code='admin-cidadao' OR (author=actor AND mem.role_code='cidadao'))
  ) INTO can_read;
  IF NOT can_read THEN
    -- Ocultar existência do protocolo para contas não autorizadas.
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004';
  END IF;
  IF EXISTS (SELECT 1 FROM app.memberships
      WHERE user_id=actor AND municipality_id=p_municipality AND active
        AND role_code='admin-cidadao') THEN
    INSERT INTO app.ouvidoria_admin_access_events(municipality_id,actor_user_id,protocol_id,action)
      VALUES(p_municipality,actor,p_protocol,'history');
  END IF;
  RETURN jsonb_build_object('items',(
    SELECT coalesce(jsonb_agg(jsonb_build_object('code',e.event_code,
      'revision',e.revision,'createdAt',e.created_at) ORDER BY e.revision), '[]'::jsonb)
    FROM app.ouvidoria_events e WHERE e.protocol_id=p_protocol
      AND e.municipality_id=p_municipality
  ));
END $$;

CREATE OR REPLACE FUNCTION app.ouvidoria_attachment_list(p_session text,p_mid uuid,p_pid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  actor := app.ouvidoria_attachment_authorized(p_session,p_mid,p_pid,false);
  IF EXISTS (SELECT 1 FROM app.memberships
      WHERE user_id=actor AND municipality_id=p_mid AND active
        AND role_code='admin-cidadao') THEN
    INSERT INTO app.ouvidoria_admin_access_events(municipality_id,actor_user_id,protocol_id,action)
      VALUES(p_mid,actor,p_pid,'attachments');
  END IF;
  RETURN jsonb_build_object('items',(
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'fileName',a.file_name,
      'mediaType',a.media_type,'sizeBytes',a.size_bytes,'status',a.scan_status,
      'createdAt',a.created_at) ORDER BY a.created_at,a.id),'[]'::jsonb)
    FROM app.ouvidoria_attachments a WHERE a.protocol_id=p_pid AND a.municipality_id=p_mid
  ));
END $$;
