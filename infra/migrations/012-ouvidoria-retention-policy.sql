-- Retenção da Ouvidoria: nenhum apagamento até aprovação legal explícita.
CREATE TABLE app.ouvidoria_retention_policy (
 municipality_id uuid PRIMARY KEY REFERENCES app.municipalities(id),
 retention_days integer CHECK(retention_days BETWEEN 30 AND 3650),
 approved_by uuid REFERENCES app.identity_users(id),
 approved_at timestamptz,
 enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(NOT enabled OR(retention_days IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
ALTER TABLE app.ouvidoria_protocols ADD COLUMN legal_hold boolean NOT NULL DEFAULT true;
REVOKE ALL ON app.ouvidoria_retention_policy FROM PUBLIC,jeriflow_app,jeriflow_scanner;

CREATE FUNCTION app.ouvidoria_retention_preview(p_session text,p_mid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; approved boolean; days_value integer; eligible integer;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor
  AND municipality_id=p_mid AND active AND role_code='admin-cidadao')
  THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 SELECT enabled,retention_days INTO approved,days_value
  FROM app.ouvidoria_retention_policy WHERE municipality_id=p_mid;
 SELECT count(*) INTO eligible FROM app.ouvidoria_protocols p
  WHERE p.municipality_id=p_mid AND p.status='closed' AND NOT p.legal_hold
   AND approved IS TRUE AND days_value IS NOT NULL
   AND p.updated_at<clock_timestamp()-make_interval(days=>days_value);
 RETURN jsonb_build_object('policyApproved',approved IS TRUE,
  'retentionDays',days_value,'eligibleCount',eligible,
  'automaticDeletionEnabled',false,'legalHoldDefault',true);
END $$;
REVOKE ALL ON FUNCTION app.ouvidoria_retention_preview(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ouvidoria_retention_preview(text,uuid) TO jeriflow_app;
