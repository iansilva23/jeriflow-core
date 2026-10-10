-- Resumo persistente por usuário/município; sem detalhes de denúncias.
-- Migração aditiva: não altera 001-012 nem remove dados existentes.
CREATE OR REPLACE FUNCTION app.ouvidoria_notices_query(p_session text,p_mid uuid,p_after uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active)
  OR NOT EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor
    AND m.municipality_id=p_mid AND m.active AND m.role_code IN ('cidadao','admin-cidadao')) THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004';
 END IF;
 RETURN jsonb_build_object(
  'items',(
   SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (
    SELECT n.id,n.protocol_id AS "protocolId",n.event_code AS "code",
      n.created_at AS "createdAt",n.read_at AS "readAt"
    FROM app.ouvidoria_notices n
    WHERE n.municipality_id=p_mid AND n.recipient_user_id=actor
      AND (p_after IS NULL OR n.id<p_after)
      AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor
        AND m.municipality_id=p_mid AND m.active AND m.role_code=n.audience)
      AND (n.audience='admin-cidadao' OR EXISTS (
        SELECT 1 FROM app.ouvidoria_protocols p
        WHERE p.id=n.protocol_id AND p.author_user_id=actor))
    ORDER BY n.id DESC LIMIT 21
   ) q),
  'unreadCount',(
   SELECT count(*) FROM app.ouvidoria_notices n
   WHERE n.municipality_id=p_mid AND n.recipient_user_id=actor AND n.read_at IS NULL
     AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor
       AND m.municipality_id=p_mid AND m.active AND m.role_code=n.audience)
     AND (n.audience='admin-cidadao' OR EXISTS (
       SELECT 1 FROM app.ouvidoria_protocols p
       WHERE p.id=n.protocol_id AND p.author_user_id=actor))),
  'totalCount',(
   SELECT count(*) FROM app.ouvidoria_notices n
   WHERE n.municipality_id=p_mid AND n.recipient_user_id=actor
     AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor
       AND m.municipality_id=p_mid AND m.active AND m.role_code=n.audience)
     AND (n.audience='admin-cidadao' OR EXISTS (
       SELECT 1 FROM app.ouvidoria_protocols p
       WHERE p.id=n.protocol_id AND p.author_user_id=actor)))
 );
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_notices_query(text,uuid,uuid) FROM PUBLIC,jeriflow_scanner;
GRANT EXECUTE ON FUNCTION app.ouvidoria_notices_query(text,uuid,uuid) TO jeriflow_app;
