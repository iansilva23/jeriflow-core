-- Histórico de movimentos da Ouvidoria, sem actor IDs nos retornos.
-- Consulta apenas ao autor Cidadão ou à equipe Admin Cidadão no MESMO município.
CREATE FUNCTION app.ouvidoria_history(p_session text,p_municipality uuid,p_protocol uuid) RETURNS jsonb
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
  RETURN jsonb_build_object('items',(
    SELECT coalesce(jsonb_agg(jsonb_build_object('code',e.event_code,
      'revision',e.revision,'createdAt',e.created_at) ORDER BY e.revision), '[]'::jsonb)
    FROM app.ouvidoria_events e WHERE e.protocol_id=p_protocol
      AND e.municipality_id=p_municipality
  ));
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_history(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ouvidoria_history(text,uuid,uuid) TO jeriflow_app;
