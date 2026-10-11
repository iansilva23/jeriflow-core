-- JeriFlow V5.16 — Etapa 29: assumir e finalizar na Guarda de Trânsito.
-- FONTE ABSOLUTA ANTES DE EDITAR:
-- ZIP original SHA-256 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- guarda-semus/index.html: acceptReport(), finishBtn, serviceResult,
-- serviceAction, serviceNote; admin-semus/index.html: fila e histórico.
-- Pré-requisitos: 001–010 + 023. NÃO criar segundo protocolo, estado de
-- produto, pagamento ou outra tabela de ocorrências; NÃO modificar 005/023.
-- Todos os comandos abaixo usam a MESMA app.citizen_v516_traffic_protocols.

CREATE TABLE app.guard_v516_service_rounds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 protocol_id text NOT NULL REFERENCES app.citizen_v516_traffic_protocols(id)
   ON DELETE RESTRICT,
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
 round_number integer NOT NULL CHECK(round_number>=1),
 guard_user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE RESTRICT,
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 service_result text CHECK(service_result IN (
   'Veículo encontrado','Veículo não encontrado','Situação já resolvida',
   'Denúncia não confirmada')),
 service_action text CHECK(service_action IN (
   'Orientação realizada','Autuação realizada','Veículo removido/direcionado',
   'Solicitado apoio','Sem providência necessária')),
 service_note text NOT NULL DEFAULT '' CHECK(char_length(service_note)<=2000),
 UNIQUE(protocol_id,round_number),
 CHECK(
   (finished_at IS NULL AND service_result IS NULL AND service_action IS NULL)
   OR
   (finished_at IS NOT NULL AND service_result IS NOT NULL
    AND service_action IS NOT NULL AND finished_at>=accepted_at)
 )
);
-- Um único guarda ativo por protocolo; reabertura administrativa futura
-- poderá iniciar nova rodada preservando TODAS as anteriores.
CREATE UNIQUE INDEX guard_v516_one_active_service_idx
 ON app.guard_v516_service_rounds(protocol_id) WHERE finished_at IS NULL;
CREATE INDEX guard_v516_service_guard_idx
 ON app.guard_v516_service_rounds(municipality_id,guard_user_id,accepted_at DESC);

CREATE TABLE app.guard_v516_service_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 service_id uuid NOT NULL REFERENCES app.guard_v516_service_rounds(id)
   ON DELETE RESTRICT,
 protocol_id text NOT NULL REFERENCES app.citizen_v516_traffic_protocols(id)
   ON DELETE RESTRICT,
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES app.identity_users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('ACCEPTED','FINISHED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX guard_v516_events_history_idx
 ON app.guard_v516_service_events(municipality_id,protocol_id,created_at);

-- O ADM SEMUS acompanha a fila, mas a operação de campo é do guarda.
-- Revalida a sessão do esquema 001–003 e o papel ativo, não aceita id de
-- guarda enviado pelo app. A permissão admin-semus, sozinha, NÃO assume.
CREATE FUNCTION app.guard_v516_field_actor(
 p_mid uuid,p_session_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.citizen_v516_guard_actor(p_mid,p_session_hash);
 PERFORM 1 FROM app.memberships m
  WHERE m.user_id=actor AND m.municipality_id=p_mid
    AND m.active AND m.role_code='guarda';
 IF NOT FOUND THEN
   RAISE EXCEPTION 'FIELD_GUARD_REQUIRED' USING ERRCODE='JF003';
 END IF;
 RETURN actor;
END $$;

-- ASSUMIR: COMMIT do evento de auditoria + estado EM ATENDIMENTO na MESMA
-- transação PG. FOR UPDATE serializa disputas simultâneas de agentes.
CREATE FUNCTION app.guard_v516_accept(
 p_mid uuid,p_session_hash text,p_protocol text,p_request uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; rec app.citizen_v516_traffic_protocols%ROWTYPE;
 existing app.guard_v516_service_events%ROWTYPE;
 new_service_id uuid; next_round integer;
BEGIN
 actor:=app.guard_v516_field_actor(p_mid,p_session_hash);
 IF p_request IS NULL OR p_protocol IS NULL
   OR p_protocol !~ '^JF-[0-9]{8}-[0-9]{6,}$' THEN
   RAISE EXCEPTION 'INVALID_GUARD_COMMAND' USING ERRCODE='JF001';
 END IF;
 SELECT * INTO rec FROM app.citizen_v516_traffic_protocols
  WHERE municipality_id=p_mid AND id=p_protocol FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'GUARD_PROTOCOL_NOT_FOUND' USING ERRCODE='JF004';
 END IF;
 SELECT * INTO existing FROM app.guard_v516_service_events
  WHERE request_id=p_request;
 IF FOUND THEN
   IF existing.protocol_id=p_protocol AND existing.municipality_id=p_mid
      AND existing.actor_user_id=actor AND existing.action='ACCEPTED' THEN
     RETURN jsonb_build_object('protocolId',rec.id,'status',rec.status,
       'alreadyProcessed',true);
   END IF;
   RAISE EXCEPTION 'GUARD_REQUEST_CONFLICT' USING ERRCODE='JF005';
 END IF;
 IF rec.status<>'RECEBIDA' THEN
   RAISE EXCEPTION 'GUARD_TRANSITION_DENIED' USING ERRCODE='JF005';
 END IF;
 SELECT coalesce(max(round_number),0)+1 INTO next_round
  FROM app.guard_v516_service_rounds WHERE protocol_id=p_protocol;
 INSERT INTO app.guard_v516_service_rounds(
  protocol_id,municipality_id,round_number,guard_user_id)
 VALUES(p_protocol,p_mid,next_round,actor) RETURNING id INTO new_service_id;
 UPDATE app.citizen_v516_traffic_protocols
  SET status='EM ATENDIMENTO',updated_at=clock_timestamp()
  WHERE id=p_protocol AND municipality_id=p_mid;
 INSERT INTO app.guard_v516_service_events(
  request_id,service_id,protocol_id,municipality_id,actor_user_id,action)
 VALUES(p_request,new_service_id,p_protocol,p_mid,actor,'ACCEPTED');
 RETURN jsonb_build_object('protocolId',p_protocol,'status','EM ATENDIMENTO',
   'alreadyProcessed',false);
END $$;

-- FINALIZAR: somente o MESMO guarda que assumiu. Valores são exatamente
-- as opções originais de serviceResult/serviceAction no HTML V5.16.
CREATE FUNCTION app.guard_v516_finish(
 p_mid uuid,p_session_hash text,p_protocol text,p_request uuid,
 p_result text,p_action text,p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; rec app.citizen_v516_traffic_protocols%ROWTYPE;
 existing app.guard_v516_service_events%ROWTYPE;
 service app.guard_v516_service_rounds%ROWTYPE;
 finished_at timestamptz;
BEGIN
 actor:=app.guard_v516_field_actor(p_mid,p_session_hash);
 IF p_request IS NULL OR p_protocol IS NULL
   OR p_protocol !~ '^JF-[0-9]{8}-[0-9]{6,}$'
   OR p_result IS NULL OR p_result NOT IN (
     'Veículo encontrado','Veículo não encontrado','Situação já resolvida',
     'Denúncia não confirmada')
   OR p_action IS NULL OR p_action NOT IN (
     'Orientação realizada','Autuação realizada',
     'Veículo removido/direcionado','Solicitado apoio',
     'Sem providência necessária')
   OR p_note IS NULL OR char_length(trim(p_note))>2000
   OR p_note ~ '[\x00-\x08\x0B\x0C\x0E-\x1F]'
 THEN
   RAISE EXCEPTION 'INVALID_GUARD_COMMAND' USING ERRCODE='JF001';
 END IF;
 SELECT * INTO rec FROM app.citizen_v516_traffic_protocols
  WHERE municipality_id=p_mid AND id=p_protocol FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'GUARD_PROTOCOL_NOT_FOUND' USING ERRCODE='JF004';
 END IF;
 SELECT * INTO existing FROM app.guard_v516_service_events
  WHERE request_id=p_request;
 IF FOUND THEN
   IF existing.protocol_id=p_protocol AND existing.municipality_id=p_mid
      AND existing.actor_user_id=actor AND existing.action='FINISHED' THEN
     RETURN jsonb_build_object('protocolId',p_protocol,'status',rec.status,
       'alreadyProcessed',true);
   END IF;
   RAISE EXCEPTION 'GUARD_REQUEST_CONFLICT' USING ERRCODE='JF005';
 END IF;
 IF rec.status<>'EM ATENDIMENTO' THEN
   RAISE EXCEPTION 'GUARD_TRANSITION_DENIED' USING ERRCODE='JF005';
 END IF;
 SELECT * INTO service FROM app.guard_v516_service_rounds s
  WHERE s.protocol_id=p_protocol AND s.municipality_id=p_mid
    AND s.finished_at IS NULL FOR UPDATE;
 IF NOT FOUND OR service.guard_user_id<>actor THEN
   RAISE EXCEPTION 'NOT_ASSIGNED_GUARD' USING ERRCODE='JF003';
 END IF;
 finished_at:=clock_timestamp();
 UPDATE app.guard_v516_service_rounds SET
   finished_at=finished_at,
   service_result=p_result,service_action=p_action,service_note=trim(p_note)
  WHERE id=service.id;
 UPDATE app.citizen_v516_traffic_protocols
  SET status='FINALIZADA',updated_at=finished_at
  WHERE id=p_protocol AND municipality_id=p_mid;
 INSERT INTO app.guard_v516_service_events(
  request_id,service_id,protocol_id,municipality_id,actor_user_id,action)
 VALUES(p_request,service.id,p_protocol,p_mid,actor,'FINISHED');
 RETURN jsonb_build_object('protocolId',p_protocol,'status','FINALIZADA',
   'alreadyProcessed',false);
END $$;

-- Histórico de todas as rodadas (necessário para futura reabertura oficial).
-- Consulta por guarda e administração SEMUS com município/sessão ativos.
CREATE FUNCTION app.guard_v516_service_history(
 p_mid uuid,p_session_hash text,p_protocol text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE history jsonb;
BEGIN
 PERFORM app.citizen_v516_guard_actor(p_mid,p_session_hash);
 IF p_protocol IS NULL OR p_protocol !~ '^JF-[0-9]{8}-[0-9]{6,}$' THEN
   RAISE EXCEPTION 'INVALID_GUARD_QUERY' USING ERRCODE='JF001';
 END IF;
 PERFORM 1 FROM app.citizen_v516_traffic_protocols
  WHERE id=p_protocol AND municipality_id=p_mid;
 IF NOT FOUND THEN RAISE EXCEPTION 'GUARD_PROTOCOL_NOT_FOUND' USING ERRCODE='JF004'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
    'round',s.round_number,
    'acceptedAt',s.accepted_at,'acceptedBy',u.display_name,
    'finishedAt',s.finished_at,'serviceResult',s.service_result,
    'serviceAction',s.service_action,'serviceNote',s.service_note
   ) ORDER BY s.round_number),'[]'::jsonb) INTO history
 FROM app.guard_v516_service_rounds s
 JOIN app.identity_users u ON u.id=s.guard_user_id
 WHERE s.protocol_id=p_protocol AND s.municipality_id=p_mid;
 RETURN jsonb_build_object('protocolId',p_protocol,'rounds',history);
END $$;

REVOKE ALL ON app.guard_v516_service_rounds,app.guard_v516_service_events
  FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker,jeriflow_v516_reconciler;
REVOKE ALL ON FUNCTION
  app.guard_v516_field_actor(uuid,text),
  app.guard_v516_accept(uuid,text,text,uuid),
  app.guard_v516_finish(uuid,text,text,uuid,text,text,text),
  app.guard_v516_service_history(uuid,text,text)
 FROM PUBLIC,jeriflow_app,jeriflow_v516_scan_worker,jeriflow_v516_reconciler;
GRANT EXECUTE ON FUNCTION
  app.guard_v516_accept(uuid,text,text,uuid),
  app.guard_v516_finish(uuid,text,text,uuid,text,text,text),
  app.guard_v516_service_history(uuid,text,text)
 TO jeriflow_app;
