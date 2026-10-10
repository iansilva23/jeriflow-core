-- Corrige ordem de feed para cronologia real: UUID aleatório não ordena datas.
-- Cursor vinculado ao próprio usuário e município; migração aditiva.
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
      AND (p_after IS NULL OR (n.created_at,n.id)<(
       SELECT c.created_at,c.id FROM app.ouvidoria_notices c
       WHERE c.id=p_after AND c.municipality_id=p_mid AND c.recipient_user_id=actor))
      AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.user_id=actor
        AND m.municipality_id=p_mid AND m.active AND m.role_code=n.audience)
      AND (n.audience='admin-cidadao' OR EXISTS (
        SELECT 1 FROM app.ouvidoria_protocols p
        WHERE p.id=n.protocol_id AND p.author_user_id=actor))
    ORDER BY n.created_at DESC,n.id DESC LIMIT 21
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
