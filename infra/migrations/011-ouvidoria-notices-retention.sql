-- Notificações internas: somente códigos genéricos, sem títulos, nomes ou conteúdo.
CREATE TABLE app.ouvidoria_notices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES app.ouvidoria_events(id),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 protocol_id uuid NOT NULL REFERENCES app.ouvidoria_protocols(id),
 recipient_user_id uuid NOT NULL REFERENCES app.identity_users(id),
 audience text NOT NULL CHECK(audience IN ('cidadao','admin-cidadao')),
 event_code text NOT NULL CHECK(event_code IN ('created','triaged','responded','contested','closed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 read_at timestamptz,
 UNIQUE(event_id,recipient_user_id,audience)
);
CREATE INDEX ouvidoria_notices_recipient_idx ON app.ouvidoria_notices(recipient_user_id,id);
REVOKE ALL ON app.ouvidoria_notices FROM PUBLIC,jeriflow_app,jeriflow_scanner;
CREATE FUNCTION app.ouvidoria_notice_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
BEGIN
  -- O criador e quem recebe atualizações não recebem payload do protocolo.
  INSERT INTO app.ouvidoria_notices(event_id,municipality_id,protocol_id,recipient_user_id,audience,event_code)
  SELECT NEW.id,NEW.municipality_id,NEW.protocol_id,p.author_user_id,'cidadao',NEW.event_code
  FROM app.ouvidoria_protocols p WHERE p.id=NEW.protocol_id;
  IF NEW.event_code IN ('created','contested') THEN
    INSERT INTO app.ouvidoria_notices(event_id,municipality_id,protocol_id,recipient_user_id,audience,event_code)
    SELECT NEW.id,NEW.municipality_id,NEW.protocol_id,m.user_id,'admin-cidadao',NEW.event_code
    FROM app.memberships m WHERE m.municipality_id=NEW.municipality_id
      AND m.role_code='admin-cidadao' AND m.active;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_notice_event() FROM PUBLIC;
CREATE TRIGGER ouvidoria_notice_after_event AFTER INSERT ON app.ouvidoria_events
FOR EACH ROW EXECUTE FUNCTION app.ouvidoria_notice_event();

CREATE FUNCTION app.ouvidoria_notices_query(p_session text,p_mid uuid,p_after uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active) THEN
   RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004';
 END IF;
 RETURN jsonb_build_object('items',(
  SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (
   SELECT n.id,n.protocol_id AS "protocolId",n.event_code AS "code",n.created_at AS "createdAt",n.read_at AS "readAt"
   FROM app.ouvidoria_notices n WHERE n.recipient_user_id=actor AND n.municipality_id=p_mid
     AND (p_after IS NULL OR n.id>p_after)
     AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor
       AND m.municipality_id=p_mid AND m.active AND m.role_code=n.audience)
     AND (n.audience='admin-cidadao' OR EXISTS (
       SELECT 1 FROM app.ouvidoria_protocols p WHERE p.id=n.protocol_id AND p.author_user_id=actor))
   ORDER BY n.id LIMIT 21
  ) q
 ));
END $$;
CREATE FUNCTION app.ouvidoria_notice_read(p_session text,p_mid uuid,p_notice uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; updated uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 UPDATE app.ouvidoria_notices n SET read_at=COALESCE(n.read_at,clock_timestamp())
 WHERE n.id=p_notice AND n.municipality_id=p_mid AND n.recipient_user_id=actor
   AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor AND
     m.municipality_id=p_mid AND m.role_code=n.audience AND m.active)
   AND (n.audience='admin-cidadao' OR EXISTS(SELECT 1 FROM app.ouvidoria_protocols p
     WHERE p.id=n.protocol_id AND p.author_user_id=actor))
 RETURNING n.id INTO updated;
 IF updated IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_notices_query(text,uuid,uuid),
 app.ouvidoria_notice_read(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ouvidoria_notices_query(text,uuid,uuid),
 app.ouvidoria_notice_read(text,uuid,uuid) TO jeriflow_app;

-- Retenção: proteger por padrão; prazos dependem de ato institucional e parecer LGPD.
CREATE TABLE app.ouvidoria_retention_hold(
 protocol_id uuid PRIMARY KEY REFERENCES app.ouvidoria_protocols(id),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 legal_hold boolean NOT NULL DEFAULT true,
 reason_code text NOT NULL DEFAULT 'awaiting_policy'
   CHECK(reason_code IN ('awaiting_policy','litigation','investigation','other')),
 updated_by uuid NOT NULL REFERENCES app.identity_users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION app.ouvidoria_retention_protect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $
BEGIN
  INSERT INTO app.ouvidoria_retention_hold(protocol_id,municipality_id,updated_by,legal_hold,reason_code)
   VALUES(NEW.id,NEW.municipality_id,NEW.author_user_id,true,'awaiting_policy');
  RETURN NEW;
END $;
REVOKE ALL ON FUNCTION app.ouvidoria_retention_protect() FROM PUBLIC;
CREATE TRIGGER ouvidoria_retention_after_create AFTER INSERT ON app.ouvidoria_protocols
FOR EACH ROW EXECUTE FUNCTION app.ouvidoria_retention_protect();
-- Preservar protocolos anteriores à migração, sem alterá-los.
INSERT INTO app.ouvidoria_retention_hold(protocol_id,municipality_id,updated_by,legal_hold,reason_code)
 SELECT id,municipality_id,author_user_id,true,'awaiting_policy' FROM app.ouvidoria_protocols
ON CONFLICT(protocol_id) DO NOTHING;

CREATE TABLE app.ouvidoria_retention_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 protocol_id uuid NOT NULL REFERENCES app.ouvidoria_protocols(id),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
 request_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('hold','review')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON app.ouvidoria_retention_hold,app.ouvidoria_retention_audit
 FROM PUBLIC,jeriflow_app,jeriflow_scanner;
-- Nenhum comando de exclusão é concedido à API ou ao scanner.
CREATE FUNCTION app.ouvidoria_retention_review(p_session text,p_mid uuid,p_pid uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; exists_protocol uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor
   AND m.municipality_id=p_mid AND m.role_code='admin-cidadao' AND m.active)
 THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 SELECT p.id INTO exists_protocol FROM app.ouvidoria_protocols p
  WHERE p.municipality_id=p_mid AND p.id=p_pid FOR SHARE;
 IF exists_protocol IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 INSERT INTO app.ouvidoria_retention_audit(protocol_id,municipality_id,actor_user_id,request_id,action)
 VALUES(p_pid,p_mid,actor,p_request,'review');
 RETURN jsonb_build_object('protocolId',p_pid,'automaticDeletion',false,
   'policyStatus','awaiting_institutional_approval','protected',
   EXISTS(SELECT 1 FROM app.ouvidoria_retention_hold h
      WHERE h.protocol_id=p_pid AND h.municipality_id=p_mid AND h.legal_hold));
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_retention_review(text,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ouvidoria_retention_review(text,uuid,uuid,uuid) TO jeriflow_app;
