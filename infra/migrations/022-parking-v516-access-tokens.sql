-- JeriFlow V5.16 — chave de viagem emitida no ADM Turismo.
-- Fonte: ZIP V5.16 SHA256
-- 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- admin-turismo/index.html makeParkingToken()/showAccessToken()/printParkingVoucher();
-- turista/index.html validateParkingToken()/activateParkingToken()/isLinkedParkingActive().
-- Não confundir estacionamento com TTS. Dependência: migrações 020 e 021.
CREATE TABLE app.parking_v516_access_keys (
 registration_id uuid PRIMARY KEY REFERENCES app.parking_v516_registrations(id) ON DELETE RESTRICT,
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id) ON DELETE RESTRICT,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 token_ciphertext bytea NOT NULL CHECK(octet_length(token_ciphertext) BETWEEN 1 AND 512),
 token_iv bytea NOT NULL CHECK(octet_length(token_iv)=12),
 token_tag bytea NOT NULL CHECK(octet_length(token_tag)=16),
 issued_by uuid NOT NULL REFERENCES app.identity_users(id),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 revoke_reason text CHECK(length(revoke_reason)<=400)
);
CREATE TABLE app.parking_v516_access_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 registration_id uuid NOT NULL REFERENCES app.parking_v516_registrations(id),
 municipality_id uuid NOT NULL REFERENCES app.municipalities(id),
 event text NOT NULL CHECK(event IN ('ISSUED','REISSUED','REVOKED','REPRINTED')),
 actor uuid NOT NULL REFERENCES app.identity_users(id),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX parking_v516_access_audit_reg_idx ON
 app.parking_v516_access_audit(registration_id,occurred_at);

CREATE FUNCTION app.parking_v516_issue_access(
 p_mid uuid,p_session_hash text,p_reg uuid,p_token_hash text,
 p_ciphertext bytea,p_iv bytea,p_tag bytea
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; existing app.parking_v516_access_keys%ROWTYPE;
BEGIN
 actor:=app.parking_v516_actor(p_mid,p_session_hash);
 IF p_reg IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
    OR p_ciphertext IS NULL OR octet_length(p_ciphertext) NOT BETWEEN 1 AND 512
    OR p_iv IS NULL OR octet_length(p_iv)<>12
    OR p_tag IS NULL OR octet_length(p_tag)<>16 THEN
   RAISE EXCEPTION 'INVALID_PARKING_TOKEN' USING ERRCODE='JF001';
 END IF;
 PERFORM 1 FROM app.parking_v516_registrations r
  WHERE r.id=p_reg AND r.municipality_id=p_mid AND r.manual_exit_at IS NULL
  FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PARKING_NOT_ELIGIBLE' USING ERRCODE='JF004'; END IF;
 SELECT * INTO existing FROM app.parking_v516_access_keys WHERE registration_id=p_reg FOR UPDATE;
 IF FOUND THEN
   IF existing.municipality_id<>p_mid OR existing.revoked_at IS NULL THEN
     RAISE EXCEPTION 'PARKING_TOKEN_ALREADY_ACTIVE' USING ERRCODE='JF005';
   END IF;
   UPDATE app.parking_v516_access_keys SET token_hash=p_token_hash,
     token_ciphertext=p_ciphertext,token_iv=p_iv,token_tag=p_tag,
     revoked_at=NULL,revoke_reason=NULL,issued_by=actor,
     issued_at=clock_timestamp() WHERE registration_id=p_reg;
   INSERT INTO app.parking_v516_access_audit
    (registration_id,municipality_id,event,actor) VALUES(p_reg,p_mid,'REISSUED',actor);
 ELSE
   INSERT INTO app.parking_v516_access_keys(
     registration_id,municipality_id,token_hash,token_ciphertext,
     token_iv,token_tag,issued_by)
   VALUES(p_reg,p_mid,p_token_hash,p_ciphertext,p_iv,p_tag,actor);
   INSERT INTO app.parking_v516_access_audit
    (registration_id,municipality_id,event,actor) VALUES(p_reg,p_mid,'ISSUED',actor);
 END IF;
END $$;

CREATE FUNCTION app.parking_v516_reprint_access(
 p_mid uuid,p_session_hash text,p_reg uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid; k app.parking_v516_access_keys%ROWTYPE;
BEGIN
 actor:=app.parking_v516_actor(p_mid,p_session_hash);
 SELECT * INTO k FROM app.parking_v516_access_keys
   WHERE municipality_id=p_mid AND registration_id=p_reg AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'PARKING_TOKEN_NOT_FOUND' USING ERRCODE='JF004'; END IF;
 INSERT INTO app.parking_v516_access_audit
   (registration_id,municipality_id,event,actor) VALUES(p_reg,p_mid,'REPRINTED',actor);
 RETURN jsonb_build_object(
  'tokenHash',k.token_hash,
  'ciphertext',encode(k.token_ciphertext,'hex'),
  'iv',encode(k.token_iv,'hex'),
  'tag',encode(k.token_tag,'hex'));
END $$;

-- A chave inteira permanece fora do banco em texto claro. O token apresentado
-- pelo Turista é hash SHA-256 validado por esta função. Entitlement ligado à
-- ocupação física, NÃO ao vencimento da diária, como no HTML V5.16.
CREATE FUNCTION app.parking_v516_lookup_access(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE rec record;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
   RETURN jsonb_build_object('valid',false);
 END IF;
 SELECT r.id,r.plate,r.brand,r.model,r.lodging,r.entry_at,r.paid_until,
   r.paid_days,r.total_paid_cents
 INTO rec
 FROM app.parking_v516_access_keys k
 JOIN app.parking_v516_registrations r ON r.id=k.registration_id
  AND r.municipality_id=k.municipality_id
 JOIN app.municipalities m ON m.id=r.municipality_id AND m.active
 WHERE k.token_hash=p_token_hash AND k.revoked_at IS NULL
   AND r.manual_exit_at IS NULL AND r.entry_at<=clock_timestamp();
 IF NOT FOUND THEN RETURN jsonb_build_object('valid',false); END IF;
 RETURN jsonb_build_object('valid',true,'parking',
   jsonb_build_object('registrationId',rec.id,'plate',rec.plate,
   'brand',rec.brand,'model',rec.model,'hotel',rec.lodging,
   'entryAt',rec.entry_at,'paidUntil',rec.paid_until,
   'paidDays',rec.paid_days,'totalPaidCents',rec.total_paid_cents));
END $$;

CREATE FUNCTION app.parking_v516_revoke_access(
 p_mid uuid,p_session_hash text,p_reg uuid,p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=app.parking_v516_actor(p_mid,p_session_hash);
 IF p_reg IS NULL OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 400 THEN
   RAISE EXCEPTION 'INVALID_REVOCATION_REASON' USING ERRCODE='JF001';
 END IF;
 UPDATE app.parking_v516_access_keys SET revoked_at=clock_timestamp(),
  revoke_reason=trim(p_reason)
 WHERE municipality_id=p_mid AND registration_id=p_reg AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'PARKING_TOKEN_NOT_FOUND' USING ERRCODE='JF004'; END IF;
 INSERT INTO app.parking_v516_access_audit
  (registration_id,municipality_id,event,actor)
 VALUES(p_reg,p_mid,'REVOKED',actor);
END $$;
REVOKE ALL ON app.parking_v516_access_keys,app.parking_v516_access_audit
 FROM PUBLIC,jeriflow_app;
REVOKE ALL ON FUNCTION
 app.parking_v516_issue_access(uuid,text,uuid,text,bytea,bytea,bytea),
 app.parking_v516_reprint_access(uuid,text,uuid),
 app.parking_v516_lookup_access(text),
 app.parking_v516_revoke_access(uuid,text,uuid,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 app.parking_v516_issue_access(uuid,text,uuid,text,bytea,bytea,bytea),
 app.parking_v516_reprint_access(uuid,text,uuid),
 app.parking_v516_lookup_access(text),
 app.parking_v516_revoke_access(uuid,text,uuid,text)
 TO jeriflow_app;
