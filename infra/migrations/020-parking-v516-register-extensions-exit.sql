-- JeriFlow V5.16 — ADM Turismo: cadastro, diárias e saída.
-- Fonte suprema: ZIP original SHA256
-- 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- admin-turismo/index.html saveReg/saveExtension/registerManualExit/
-- confirmPhysicalExit/confirmTolerance. NÃO sobrescrever migrações 011–017
-- das PRs antigas. Migração nova isolada 020, não aplicada em produção.
--
-- Separação crítica: estacionamento NÃO emite nem altera TTS; registrar
-- pagamento significa só a confirmação MANUAL do operador, não cobrar cartão.
CREATE TABLE app.parking_v516_tariffs (
 municipality_id uuid PRIMARY KEY REFERENCES app.municipalities(id) ON DELETE RESTRICT,
 daily_rate_cents integer NOT NULL CHECK(daily_rate_cents BETWEEN 1 AND 1000000),
 enabled boolean NOT NULL DEFAULT false,
 approved_by uuid NOT NULL REFERENCES app.identity_users(id),
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.parking_v516_registrations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
 initial_request_id uuid NOT NULL UNIQUE,
 plate text NOT NULL CHECK(length(plate) BETWEEN 3 AND 12 AND plate ~ '^[A-Z0-9-]+$'),
 brand text NOT NULL CHECK(length(brand) BETWEEN 1 AND 100),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 100),
 vehicle_year integer NOT NULL CHECK(vehicle_year BETWEEN 1950 AND 2200),
 responsible_name text NOT NULL CHECK(length(responsible_name) BETWEEN 1 AND 120),
 document_id text NOT NULL DEFAULT '' CHECK(length(document_id)<=80),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=60),
 tourists text[] NOT NULL CHECK(cardinality(tourists) BETWEEN 1 AND 30),
 lodging text NOT NULL CHECK(length(lodging) BETWEEN 1 AND 200),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 entry_at timestamptz NOT NULL,
 paid_days integer NOT NULL CHECK(paid_days BETWEEN 1 AND 3650),
 daily_rate_cents integer NOT NULL CHECK(daily_rate_cents BETWEEN 1 AND 1000000),
 paid_until timestamptz NOT NULL,
 total_paid_cents bigint NOT NULL CHECK(total_paid_cents>=0),
 prepaid_multi_day boolean NOT NULL,
 no_refund_ack_at timestamptz,
 manual_exit_at timestamptz,
 exit_mode text CHECK(exit_mode IN ('NORMAL','TOLERANCE','EARLY_NO_REFUND','EARLY_ESCALATED')),
 exit_reason text CHECK(length(exit_reason)<=2000),
 exit_request_id uuid UNIQUE,
 created_by uuid NOT NULL REFERENCES app.identity_users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(paid_until=entry_at+(paid_days*interval '24 hours')),
 CHECK((prepaid_multi_day AND no_refund_ack_at IS NOT NULL AND paid_days>=2)
       OR (NOT prepaid_multi_day AND paid_days>=1)),
 CHECK((manual_exit_at IS NULL AND exit_mode IS NULL AND exit_request_id IS NULL)
       OR (manual_exit_at IS NOT NULL AND exit_mode IS NOT NULL AND exit_request_id IS NOT NULL))
);
CREATE INDEX parking_v516_municipal_presence_idx ON app.parking_v516_registrations
 (municipality_id,manual_exit_at,paid_until);
CREATE INDEX parking_v516_plate_idx ON app.parking_v516_registrations (municipality_id,plate);
-- Não contar duas vezes o MESMO veículo ainda presente no mesmo município.
-- Depois da saída real, a placa pode entrar novamente com outro cadastro.
CREATE UNIQUE INDEX parking_v516_active_plate_unique_idx
 ON app.parking_v516_registrations(municipality_id,plate)
 WHERE manual_exit_at IS NULL;
CREATE TABLE app.parking_v516_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 registration_id uuid NOT NULL REFERENCES app.parking_v516_registrations(id),
 kind text NOT NULL CHECK(kind IN ('INITIAL','EXTENSION')),
 added_days integer NOT NULL CHECK(added_days BETWEEN 1 AND 3650),
 amount_cents bigint NOT NULL CHECK(amount_cents>0),
 method text NOT NULL CHECK(method IN ('PIX','CREDITO','DEBITO','DINHEIRO','OUTRO')),
 recorded_by uuid NOT NULL REFERENCES app.identity_users(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX parking_v516_movements_reg_idx ON app.parking_v516_movements(registration_id,recorded_at);
CREATE TABLE app.parking_v516_exit_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 registration_id uuid NOT NULL REFERENCES app.parking_v516_registrations(id),
 exit_mode text NOT NULL CHECK(exit_mode IN ('NORMAL','TOLERANCE','EARLY_NO_REFUND','EARLY_ESCALATED')),
 reason text NOT NULL DEFAULT '',
 confirmed_by uuid NOT NULL REFERENCES app.identity_users(id),
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Confere sessão real, MFA e município. A API não pode mandar user_id/papel.
CREATE FUNCTION app.parking_v516_actor(p_mid uuid,p_session_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
 IF p_mid IS NULL OR p_session_hash IS NULL OR p_session_hash !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'INVALID_PARKING_SESSION' USING ERRCODE='JF003';
 END IF;
 v_actor:=app.account_actor(p_session_hash,false);
 PERFORM 1 FROM app.identity_users u
  JOIN app.identity_sessions s ON s.user_id=u.id AND s.token_hash=p_session_hash
  WHERE u.id=v_actor AND u.active AND u.email_verified_at IS NOT NULL
   AND u.mfa_secret IS NOT NULL AND s.mfa_verified_at IS NOT NULL
   AND s.mfa_version=u.mfa_version
   AND (u.platform_admin OR EXISTS (
      SELECT 1 FROM app.memberships m JOIN app.municipalities city
       ON city.id=m.municipality_id
      WHERE m.user_id=u.id AND m.municipality_id=p_mid
       AND m.active AND city.active AND m.role_code='admin-turismo'));
 IF NOT FOUND THEN
   RAISE EXCEPTION 'PARKING_ROLE_DENIED' USING ERRCODE='JF003';
 END IF;
 RETURN v_actor;
END $$;

CREATE FUNCTION app.parking_v516_register(
 p_mid uuid,p_session_hash text,p_request uuid,p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; tariff integer; r app.parking_v516_registrations%ROWTYPE;
 v_days integer; v_year integer; v_entry timestamptz; v_method text;
 v_plate text; v_brand text; v_model text; v_names text[];
 v_hotel text; v_responsible text; v_ack boolean; v_id uuid;
BEGIN
 actor:=app.parking_v516_actor(p_mid,p_session_hash);
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_payload) AS input_keys(key)
       WHERE key NOT IN ('plate','brand','model','year','entryAt','days',
        'tourists','responsible','document','phone','hotel','notes',
        'noRefundAcknowledged','paymentMethod'))>0 THEN
   RAISE EXCEPTION 'INVALID_PARKING_RECORD' USING ERRCODE='JF001';
 END IF;
 SELECT * INTO r FROM app.parking_v516_registrations WHERE initial_request_id=p_request;
 IF FOUND THEN
   IF r.municipality_id<>p_mid OR r.created_by<>actor THEN
     RAISE EXCEPTION 'PARKING_REQUEST_CONFLICT' USING ERRCODE='JF003';
   END IF;
   RETURN r.id;
 END IF;
 BEGIN
   v_days:=(p_payload->>'days')::integer;
   v_year:=(p_payload->>'year')::integer;
   v_entry:=(p_payload->>'entryAt')::timestamptz;
 EXCEPTION WHEN OTHERS THEN
   RAISE EXCEPTION 'INVALID_PARKING_RECORD' USING ERRCODE='JF001';
 END;
 v_ack:=(p_payload->>'noRefundAcknowledged')='true';
 v_plate:=upper(trim(coalesce(p_payload->>'plate','')));
 v_brand:=trim(coalesce(p_payload->>'brand',''));
 v_model:=trim(coalesce(p_payload->>'model',''));
 v_hotel:=trim(coalesce(p_payload->>'hotel',''));
 v_responsible:=trim(coalesce(p_payload->>'responsible',''));
 v_method:=p_payload->>'paymentMethod';
 IF jsonb_typeof(p_payload->'tourists') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'PARKING_TOURISTS_REQUIRED' USING ERRCODE='JF001';
 END IF;
 SELECT array_agg(trim(value) ORDER BY ordinality) INTO v_names
   FROM jsonb_array_elements_text(p_payload->'tourists') WITH ORDINALITY AS names(value,ordinality);
 IF v_days NOT BETWEEN 1 AND 3650 OR v_year<1950 OR
    v_year>extract(year from clock_timestamp())::integer+1
    OR v_entry IS NULL OR v_entry>clock_timestamp()+interval '1 day'
    OR v_entry<clock_timestamp()-interval '5 years'
    OR v_plate !~ '^[A-Z0-9-]{3,12}$'
    OR length(v_brand) NOT BETWEEN 1 AND 100
    OR length(v_model) NOT BETWEEN 1 AND 100
    OR length(v_hotel) NOT BETWEEN 1 AND 200
    OR length(v_responsible) NOT BETWEEN 1 AND 120
    OR v_method NOT IN ('PIX','CREDITO','DEBITO','DINHEIRO','OUTRO')
    OR v_names IS NULL OR cardinality(v_names) NOT BETWEEN 1 AND 30
    OR EXISTS(SELECT 1 FROM unnest(v_names) n WHERE length(n) NOT BETWEEN 1 AND 120)
    OR (v_days>1 AND NOT v_ack)
    OR length(coalesce(p_payload->>'document',''))>80
    OR length(coalesce(p_payload->>'phone',''))>60
    OR length(coalesce(p_payload->>'notes',''))>2000 THEN
   RAISE EXCEPTION 'INVALID_PARKING_RECORD' USING ERRCODE='JF001';
 END IF;
 SELECT t.daily_rate_cents INTO tariff FROM app.parking_v516_tariffs t
  WHERE t.municipality_id=p_mid AND t.enabled AND t.approved_at IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PARKING_TARIFF_NOT_APPROVED' USING ERRCODE='JF004'; END IF;
 INSERT INTO app.parking_v516_registrations(
  municipality_id,initial_request_id,plate,brand,model,vehicle_year,
  responsible_name,document_id,phone,tourists,lodging,notes,
  entry_at,paid_days,daily_rate_cents,paid_until,total_paid_cents,
  prepaid_multi_day,no_refund_ack_at,created_by)
 VALUES(p_mid,p_request,v_plate,v_brand,v_model,v_year,
  v_responsible,coalesce(p_payload->>'document',''),
  coalesce(p_payload->>'phone',''),v_names,v_hotel,
  coalesce(p_payload->>'notes',''),v_entry,v_days,tariff,
  v_entry+v_days*interval '24 hours',(v_days::bigint*tariff),
  v_days>1,CASE WHEN v_days>1 THEN clock_timestamp() ELSE NULL END,actor)
 RETURNING id INTO v_id;
 INSERT INTO app.parking_v516_movements(
  request_id,municipality_id,registration_id,kind,
  added_days,amount_cents,method,recorded_by)
 VALUES(p_request,p_mid,v_id,'INITIAL',v_days,
  (v_days::bigint*tariff),v_method,actor);
 RETURN v_id;
END $$;

CREATE FUNCTION app.parking_v516_extend(
 p_mid uuid,p_session_hash text,p_request uuid,p_reg uuid,
 p_extra_days integer,p_method text
) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; r app.parking_v516_registrations%ROWTYPE;
BEGIN
 actor:=app.parking_v516_actor(p_mid,p_session_hash);
 IF p_request IS NULL OR p_reg IS NULL OR p_extra_days NOT BETWEEN 1 AND 3650
    OR p_method NOT IN ('PIX','CREDITO','DEBITO','DINHEIRO','OUTRO') THEN
   RAISE EXCEPTION 'INVALID_PARKING_EXTENSION' USING ERRCODE='JF001';
 END IF;
 SELECT * INTO r FROM app.parking_v516_registrations
  WHERE id=p_reg AND municipality_id=p_mid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PARKING_RECORD_NOT_FOUND' USING ERRCODE='JF004'; END IF;
 IF EXISTS(SELECT 1 FROM app.parking_v516_movements m WHERE m.request_id=p_request
           AND m.registration_id=p_reg AND m.kind='EXTENSION') THEN
   RETURN r.paid_until;
 END IF;
 IF EXISTS(SELECT 1 FROM app.parking_v516_movements m WHERE m.request_id=p_request)
    OR r.manual_exit_at IS NOT NULL OR r.paid_days+p_extra_days>3650 THEN
   RAISE EXCEPTION 'PARKING_EXTENSION_DENIED' USING ERRCODE='JF005';
 END IF;
 UPDATE app.parking_v516_registrations SET
  paid_days=paid_days+p_extra_days,
  paid_until=paid_until+p_extra_days*interval '24 hours',
  total_paid_cents=total_paid_cents+(p_extra_days::bigint*r.daily_rate_cents)
  WHERE id=p_reg RETURNING * INTO r;
 INSERT INTO app.parking_v516_movements(
  request_id,municipality_id,registration_id,kind,added_days,amount_cents,method,recorded_by)
 VALUES(p_request,p_mid,p_reg,'EXTENSION',p_extra_days,
  (p_extra_days::bigint*r.daily_rate_cents),p_method,actor);
 RETURN r.paid_until;
END $$;

CREATE FUNCTION app.parking_v516_confirm_exit(
 p_mid uuid,p_session_hash text,p_request uuid,p_reg uuid,
 p_mode text,p_reason text
) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; r app.parking_v516_registrations%ROWTYPE;
 v_now timestamptz;
BEGIN
 actor:=app.parking_v516_actor(p_mid,p_session_hash);
 IF p_request IS NULL OR p_reg IS NULL OR
    p_mode NOT IN ('NORMAL','TOLERANCE','EARLY_NO_REFUND','EARLY_ESCALATED')
    OR length(coalesce(p_reason,''))>2000 THEN
   RAISE EXCEPTION 'INVALID_PARKING_EXIT' USING ERRCODE='JF001';
 END IF;
 SELECT * INTO r FROM app.parking_v516_registrations
  WHERE id=p_reg AND municipality_id=p_mid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PARKING_RECORD_NOT_FOUND' USING ERRCODE='JF004'; END IF;
 IF r.manual_exit_at IS NOT NULL THEN
   IF r.exit_request_id=p_request THEN RETURN r.manual_exit_at; END IF;
   RAISE EXCEPTION 'PARKING_ALREADY_EXITED' USING ERRCODE='JF005';
 END IF;
 v_now:=clock_timestamp();
 IF v_now<r.entry_at THEN
   RAISE EXCEPTION 'PARKING_NOT_ARRIVED' USING ERRCODE='JF005';
 END IF;
 IF v_now>r.paid_until AND (p_mode<>'TOLERANCE' OR trim(coalesce(p_reason,''))='') THEN
   RAISE EXCEPTION 'PARKING_OVERDUE_REQUIRES_DECISION' USING ERRCODE='JF005';
 END IF;
 IF v_now<=r.paid_until AND r.prepaid_multi_day AND v_now<r.paid_until
    AND p_mode NOT IN ('EARLY_NO_REFUND','EARLY_ESCALATED') THEN
   RAISE EXCEPTION 'PARKING_PREPAID_EARLY_EXIT' USING ERRCODE='JF005';
 END IF;
 IF (p_mode='TOLERANCE' AND v_now<=r.paid_until)
    OR (p_mode IN ('EARLY_NO_REFUND','EARLY_ESCALATED') AND
        (NOT r.prepaid_multi_day OR v_now>=r.paid_until))
    OR (p_mode='EARLY_ESCALATED' AND trim(coalesce(p_reason,''))='') THEN
   RAISE EXCEPTION 'PARKING_EXIT_MODE_DENIED' USING ERRCODE='JF005';
 END IF;
 UPDATE app.parking_v516_registrations
 SET manual_exit_at=v_now,exit_mode=p_mode,exit_reason=trim(coalesce(p_reason,'')),
   exit_request_id=p_request WHERE id=p_reg;
 INSERT INTO app.parking_v516_exit_audit(
  municipality_id,registration_id,exit_mode,reason,confirmed_by,confirmed_at)
 VALUES(p_mid,p_reg,p_mode,trim(coalesce(p_reason,'')),actor,v_now);
 RETURN v_now;
END $$;

-- Sem CRUD direto em informações de turistas, valores, diárias ou eventos.
REVOKE ALL ON app.parking_v516_tariffs,
 app.parking_v516_registrations,app.parking_v516_movements,
 app.parking_v516_exit_audit FROM PUBLIC,jeriflow_app;
REVOKE ALL ON FUNCTION
 app.parking_v516_actor(uuid,text),
 app.parking_v516_register(uuid,text,uuid,jsonb),
 app.parking_v516_extend(uuid,text,uuid,uuid,integer,text),
 app.parking_v516_confirm_exit(uuid,text,uuid,uuid,text,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 app.parking_v516_register(uuid,text,uuid,jsonb),
 app.parking_v516_extend(uuid,text,uuid,uuid,integer,text),
 app.parking_v516_confirm_exit(uuid,text,uuid,uuid,text,text)
 TO jeriflow_app;
