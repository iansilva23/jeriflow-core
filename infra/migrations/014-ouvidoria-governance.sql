-- Governança da Ouvidoria (aditiva): política somente em rascunho, guarda legal intacta.
-- Não introduz funções de DELETE nem atribui privilégios diretos ao runtime.
CREATE TABLE app.ouvidoria_retention_drafts (
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 category text NOT NULL CHECK(category IN ('denuncia','reclamacao','solicitacao','sugestao')),
 retention_days integer CHECK(retention_days BETWEEN 1 AND 36500),
 updated_by uuid NOT NULL REFERENCES app.identity_users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(municipality_id,category)
);
CREATE TABLE app.ouvidoria_archive_state (
 protocol_id uuid PRIMARY KEY REFERENCES app.ouvidoria_protocols(id),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 archived boolean NOT NULL DEFAULT false,
 updated_by uuid NOT NULL REFERENCES app.identity_users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.ouvidoria_governance_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
 request_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('inventory','draft_policy','archive','unarchive')),
 protocol_id uuid REFERENCES app.ouvidoria_protocols(id),
 category text CHECK(category IN ('denuncia','reclamacao','solicitacao','sugestao')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ouvidoria_governance_municipality_idx ON app.ouvidoria_governance_events(municipality_id,created_at);
REVOKE ALL ON app.ouvidoria_retention_drafts,app.ouvidoria_archive_state,
 app.ouvidoria_governance_events FROM PUBLIC,jeriflow_app,jeriflow_scanner;

-- Isolamento municipal + vínculo ativo; MFA é adicionalmente exigido no serviço de identidade.
CREATE FUNCTION app.ouvidoria_governance_actor(p_session text,p_mid uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active)
 OR NOT EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor
  AND m.municipality_id=p_mid AND m.active AND m.role_code='admin-cidadao') THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004';
 END IF;
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_governance_actor(text,uuid) FROM PUBLIC,jeriflow_app,jeriflow_scanner;

CREATE FUNCTION app.ouvidoria_governance_inventory(p_session text,p_mid uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.ouvidoria_governance_actor(p_session,p_mid);
 INSERT INTO app.ouvidoria_governance_events(municipality_id,actor_user_id,request_id,action)
 VALUES(p_mid,actor,p_request,'inventory');
 RETURN jsonb_build_object(
  'policyStatus','awaiting_institutional_approval',
  'automaticDeletionEnabled',false,
  'policies', (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.category),'[]'::jsonb)
   FROM (SELECT category,retention_days AS "retentionDays",updated_at AS "updatedAt"
     FROM app.ouvidoria_retention_drafts WHERE municipality_id=p_mid) d),
  'inventory', (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb)
   FROM (SELECT p.category,p.status,count(*)::integer AS "protocolCount",
    count(*) FILTER(WHERE coalesce(a.archived,false))::integer AS "archivedCount",
    count(*) FILTER(WHERE coalesce(h.legal_hold,true))::integer AS "protectedCount"
    FROM app.ouvidoria_protocols p
    LEFT JOIN app.ouvidoria_archive_state a ON a.protocol_id=p.id AND a.municipality_id=p_mid
    LEFT JOIN app.ouvidoria_retention_hold h ON h.protocol_id=p.id AND h.municipality_id=p_mid
    WHERE p.municipality_id=p_mid GROUP BY p.category,p.status ORDER BY p.category,p.status) q),
  'attachmentCount',(SELECT count(*)::integer FROM app.ouvidoria_attachments
    WHERE municipality_id=p_mid)
 );
END $$;

-- Editar prazo para estudo não equivale a aprovar nem ativa eliminação.
CREATE FUNCTION app.ouvidoria_governance_draft(p_session text,p_mid uuid,p_category text,
 p_days integer,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.ouvidoria_governance_actor(p_session,p_mid);
 IF p_category IS NULL OR p_category NOT IN ('denuncia','reclamacao','solicitacao','sugestao')
 OR (p_days IS NOT NULL AND p_days NOT BETWEEN 1 AND 36500) THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
 END IF;
 INSERT INTO app.ouvidoria_retention_drafts(municipality_id,category,retention_days,updated_by)
 VALUES(p_mid,p_category,p_days,actor)
 ON CONFLICT(municipality_id,category) DO UPDATE SET retention_days=EXCLUDED.retention_days,
  updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
 INSERT INTO app.ouvidoria_governance_events(municipality_id,actor_user_id,request_id,action,category)
 VALUES(p_mid,actor,p_request,'draft_policy',p_category);
 RETURN jsonb_build_object('category',p_category,'retentionDays',p_days,
  'policyStatus','awaiting_institutional_approval','automaticDeletionEnabled',false);
END $$;

-- Arquivamento lógico, reversível e auditado; jamais altera a proteção legal.
CREATE FUNCTION app.ouvidoria_governance_archive(p_session text,p_mid uuid,p_pid uuid,
 p_archive boolean,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; protocol_status text; was_archived boolean;
BEGIN
 actor:=app.ouvidoria_governance_actor(p_session,p_mid);
 IF p_archive IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
 SELECT status INTO protocol_status FROM app.ouvidoria_protocols
 WHERE id=p_pid AND municipality_id=p_mid FOR SHARE;
 IF protocol_status IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 IF p_archive AND protocol_status<>'closed' THEN
  RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='JF005';
 END IF;
 SELECT archived INTO was_archived FROM app.ouvidoria_archive_state
 WHERE protocol_id=p_pid AND municipality_id=p_mid FOR UPDATE;
 IF coalesce(was_archived,false) IS DISTINCT FROM p_archive THEN
  INSERT INTO app.ouvidoria_archive_state(protocol_id,municipality_id,archived,updated_by)
   VALUES(p_pid,p_mid,p_archive,actor)
  ON CONFLICT(protocol_id) DO UPDATE SET archived=EXCLUDED.archived,
   updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
  INSERT INTO app.ouvidoria_governance_events(municipality_id,actor_user_id,request_id,action,protocol_id)
   VALUES(p_mid,actor,p_request,CASE WHEN p_archive THEN 'archive' ELSE 'unarchive' END,p_pid);
 END IF;
 RETURN jsonb_build_object('protocolId',p_pid,'archived',p_archive,
  'legalHoldPreserved',true,'automaticDeletionEnabled',false);
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_governance_inventory(text,uuid,uuid),
 app.ouvidoria_governance_draft(text,uuid,text,integer,uuid),
 app.ouvidoria_governance_archive(text,uuid,uuid,boolean,uuid) FROM PUBLIC,jeriflow_scanner;
GRANT EXECUTE ON FUNCTION app.ouvidoria_governance_inventory(text,uuid,uuid),
 app.ouvidoria_governance_draft(text,uuid,text,integer,uuid),
 app.ouvidoria_governance_archive(text,uuid,uuid,boolean,uuid) TO jeriflow_app;
