-- Notificações internas sem conteúdo do protocolo ou do denunciante.
CREATE TABLE app.ouvidoria_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 protocol_id uuid NOT NULL REFERENCES app.ouvidoria_protocols(id),
 event_id uuid NOT NULL REFERENCES app.ouvidoria_events(id),
 recipient_id uuid NOT NULL REFERENCES app.identity_users(id),
 code text NOT NULL CHECK(code IN ('created','triaged','responded','contested','closed','new_request')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 read_at timestamptz,
 UNIQUE(event_id,recipient_id)
);
CREATE INDEX ouvidoria_notice_feed ON app.ouvidoria_notifications(recipient_id,municipality_id,created_at DESC);
REVOKE ALL ON app.ouvidoria_notifications FROM PUBLIC,jeriflow_app,jeriflow_scanner;

CREATE FUNCTION app.ouvidoria_notify_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE author uuid;
BEGIN
 SELECT author_user_id INTO author FROM app.ouvidoria_protocols
 WHERE id=NEW.protocol_id AND municipality_id=NEW.municipality_id;
 INSERT INTO app.ouvidoria_notifications(municipality_id,protocol_id,event_id,recipient_id,code)
 VALUES(NEW.municipality_id,NEW.protocol_id,NEW.id,author,NEW.event_code)
 ON CONFLICT DO NOTHING;
 IF NEW.event_code='created' THEN
  INSERT INTO app.ouvidoria_notifications(municipality_id,protocol_id,event_id,recipient_id,code)
  SELECT NEW.municipality_id,NEW.protocol_id,NEW.id,m.user_id,'new_request'
  FROM app.memberships m JOIN app.identity_users u ON u.id=m.user_id AND u.active
  WHERE m.municipality_id=NEW.municipality_id AND m.active AND m.role_code='admin-cidadao'
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ouvidoria_event_notification AFTER INSERT ON app.ouvidoria_events
FOR EACH ROW EXECUTE FUNCTION app.ouvidoria_notify_event();
REVOKE ALL ON FUNCTION app.ouvidoria_notify_event() FROM PUBLIC;

CREATE FUNCTION app.ouvidoria_notification_list(p_session text,p_mid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor
   AND municipality_id=p_mid AND active AND role_code IN ('cidadao','admin-cidadao'))
   THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (
  SELECT n.id,n.protocol_id AS "protocolId",n.code,n.created_at AS "createdAt",
   (n.read_at IS NOT NULL) AS "read"
  FROM app.ouvidoria_notifications n WHERE n.municipality_id=p_mid AND n.recipient_id=actor
  ORDER BY n.created_at DESC,n.id DESC LIMIT 50
 ) q));
END $$;
CREATE FUNCTION app.ouvidoria_notification_read(p_session text,p_mid uuid,p_notice uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; selected uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor
   AND municipality_id=p_mid AND active AND role_code IN ('cidadao','admin-cidadao'))
  THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 UPDATE app.ouvidoria_notifications SET read_at=coalesce(read_at,clock_timestamp())
  WHERE id=p_notice AND municipality_id=p_mid AND recipient_id=actor RETURNING id INTO selected;
 IF selected IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_notification_list(text,uuid),
 app.ouvidoria_notification_read(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ouvidoria_notification_list(text,uuid),
 app.ouvidoria_notification_read(text,uuid,uuid) TO jeriflow_app;
