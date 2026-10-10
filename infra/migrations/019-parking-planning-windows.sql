-- JeriFlow Estacionamento: projeção de janelas de 24 horas em registros FICTÍCIOS.
-- Não é diária paga, multa, autorização, cobrança, pendência financeira ou garantia de vaga.
-- A janela é uma estimativa operacional a partir da hora de cadastro no servidor.
ALTER TABLE app.parking_entry_drafts
  ADD COLUMN planned_days smallint NOT NULL DEFAULT 1
    CONSTRAINT parking_entry_drafts_planned_days_check CHECK(planned_days BETWEEN 1 AND 90);
ALTER TABLE app.parking_entry_draft_events
  DROP CONSTRAINT parking_entry_draft_events_code_check;
ALTER TABLE app.parking_entry_draft_events
  ADD CONSTRAINT parking_entry_draft_events_code_check
  CHECK (code IN ('entered','departed','extended'));

CREATE TABLE app.parking_entry_draft_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES app.parking_entry_drafts(id),
  municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
  actor_user_id uuid NOT NULL REFERENCES app.identity_users(id),
  client_request_id uuid NOT NULL,
  extra_days smallint NOT NULL CHECK(extra_days BETWEEN 1 AND 30),
  revision integer NOT NULL CHECK(revision>=2),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(entry_id,client_request_id), UNIQUE(entry_id,revision)
);
CREATE INDEX parking_entry_draft_extensions_entry_idx
  ON app.parking_entry_draft_extensions(entry_id,revision);
REVOKE ALL ON app.parking_entry_draft_extensions FROM PUBLIC,jeriflow_app,jeriflow_scanner;

CREATE FUNCTION app.parking_entry_draft_extend(p_session text,p_data jsonb,p_trace uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; mid uuid; eid uuid; req uuid; extra integer;
 rec app.parking_entry_drafts; prior app.parking_entry_draft_extensions; next_revision integer;
BEGIN
 actor:=app.account_actor(p_session,false);
 mid:=(p_data->>'municipalityId')::uuid;
 eid:=(p_data->>'entryId')::uuid;
 req:=(p_data->>'clientRequestId')::uuid;
 extra:=(p_data->>'extraDays')::integer;
 IF mid IS NULL OR eid IS NULL OR req IS NULL OR extra IS NULL OR extra NOT BETWEEN 1 AND 30 THEN
   RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=mid AND active) THEN
   RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor
   AND municipality_id=mid AND active AND role_code='admin-turismo') THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003';
 END IF;
 SELECT * INTO rec FROM app.parking_entry_drafts
   WHERE id=eid AND municipality_id=mid FOR UPDATE;
 IF rec.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 SELECT * INTO prior FROM app.parking_entry_draft_extensions
  WHERE entry_id=eid AND client_request_id=req;
 IF prior.id IS NOT NULL THEN
   IF prior.actor_user_id<>actor OR prior.extra_days<>extra THEN
     RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005';
   END IF;
   RETURN jsonb_build_object('entryId',rec.id,'revision',rec.revision,
     'status',rec.status,'plannedDays',rec.planned_days,
     'plannedUntil',rec.entry_at + (rec.planned_days*INTERVAL '24 hours'),
     'idempotent',true,'authorizationIssued',false,'paymentRegistered',false);
 END IF;
 IF rec.status<>'present' OR rec.revision IS DISTINCT FROM (p_data->>'revision')::integer
   OR rec.planned_days+extra>90 THEN
   RAISE EXCEPTION 'CONFLICT' USING ERRCODE='JF005';
 END IF;
 UPDATE app.parking_entry_drafts SET planned_days=planned_days+extra,revision=revision+1,
   updated_at=clock_timestamp() WHERE id=eid RETURNING * INTO rec;
 INSERT INTO app.parking_entry_draft_extensions
   (entry_id,municipality_id,actor_user_id,client_request_id,extra_days,revision)
   VALUES(eid,mid,actor,req,extra,rec.revision);
 INSERT INTO app.parking_entry_draft_events
   (entry_id,municipality_id,actor_user_id,trace_id,code,revision)
   VALUES(eid,mid,actor,p_trace,'extended',rec.revision);
 RETURN jsonb_build_object('entryId',rec.id,'revision',rec.revision,
   'status',rec.status,'plannedDays',rec.planned_days,
   'plannedUntil',rec.entry_at + (rec.planned_days*INTERVAL '24 hours'),
   'idempotent',false,'authorizationIssued',false,'paymentRegistered',false);
END $$;

CREATE FUNCTION app.parking_entry_draft_planning_query(p_session text,p_mid uuid,p_after uuid,p_mode text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.account_actor(p_session,false);
 IF p_mode IS NULL OR p_mode NOT IN ('all','present','needs_review','departed') THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='JF001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.municipalities WHERE id=p_mid AND active) THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='JF004'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE user_id=actor
   AND municipality_id=p_mid AND active AND role_code='admin-turismo') THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='JF003'; END IF;
 RETURN jsonb_build_object('items',(
  SELECT coalesce(jsonb_agg(to_jsonb(row_data)),'[]'::jsonb)
  FROM (
   SELECT d.id,d.vehicle_plate AS "vehiclePlate",d.vehicle_brand AS "vehicleBrand",
    d.vehicle_model AS "vehicleModel",d.area_text AS "areaText",
    d.lodging_name AS "lodgingName",d.entry_at AS "entryAt",
    d.departure_at AS "departureAt",d.status,d.revision,
    d.planned_days AS "plannedDays",
    d.entry_at + (d.planned_days*INTERVAL '24 hours') AS "plannedUntil",
    CASE WHEN d.status='departed' THEN 'departed'
         WHEN clock_timestamp() >= d.entry_at+(d.planned_days*INTERVAL '24 hours')
           THEN 'needs_review'
         ELSE 'within_window' END AS "planningStatus"
   FROM app.parking_entry_drafts d
   WHERE d.municipality_id=p_mid AND (p_after IS NULL OR d.id>p_after)
     AND (p_mode='all' OR (p_mode='present' AND d.status='present')
       OR (p_mode='departed' AND d.status='departed')
       OR (p_mode='needs_review' AND d.status='present'
         AND clock_timestamp()>=d.entry_at+(d.planned_days*INTERVAL '24 hours')))
   ORDER BY d.id LIMIT 21
  ) row_data
 ));
END $$;
REVOKE ALL ON FUNCTION app.parking_entry_draft_extend(text,jsonb,uuid),
  app.parking_entry_draft_planning_query(text,uuid,uuid,text)
 FROM PUBLIC,jeriflow_scanner;
GRANT EXECUTE ON FUNCTION app.parking_entry_draft_extend(text,jsonb,uuid),
  app.parking_entry_draft_planning_query(text,uuid,uuid,text)
 TO jeriflow_app;
