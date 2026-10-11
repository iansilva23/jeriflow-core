-- JeriFlow V5.16: consultas seguras ADM Turismo, sem CRUD direto.
-- Fonte suprema: ZIP SHA256
-- 89b8ff9b48b18a95c07ad144881243d54ba0fef33a5d4f5312379e70e5208fad
-- admin-turismo/index.html renderAll(), dueState(), voucherStatus(),
-- paymentMovements(). Nenhuma funcao ou view cria pagamentos/TTS.
-- Dependência: 020-parking-v516-register-extensions-exit.sql.
CREATE FUNCTION app.parking_v516_admin_list(
 p_mid uuid,p_session_hash text,p_after uuid,p_limit integer,
 p_filter text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE out_json jsonb;
BEGIN
 PERFORM app.parking_v516_actor(p_mid,p_session_hash);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR p_filter IS NULL OR p_filter NOT IN
      ('ALL','PRESENT','OVERDUE','EXITED','DUE_TODAY') THEN
   RAISE EXCEPTION 'INVALID_PARKING_QUERY' USING ERRCODE='JF001';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
 INTO out_json FROM (
  SELECT id,plate,brand,model,vehicle_year AS "vehicleYear",
    responsible_name AS "responsibleName",document_id AS "document",
    phone,tourists,lodging,notes,entry_at AS "entryAt",
    paid_days AS "paidDays",daily_rate_cents AS "dailyRateCents",
    paid_until AS "paidUntil",total_paid_cents AS "totalPaidCents",
    prepaid_multi_day AS "prepaidMultiDay",manual_exit_at AS "manualExitAt",
    exit_mode AS "exitMode",
    CASE
      WHEN manual_exit_at IS NOT NULL THEN 'EXITED'
      WHEN entry_at>clock_timestamp() THEN 'UPCOMING'
      WHEN paid_until<clock_timestamp() THEN 'OVERDUE'
      WHEN (paid_until AT TIME ZONE 'America/Fortaleza')::date=
           (clock_timestamp() AT TIME ZONE 'America/Fortaleza')::date THEN 'DUE_TODAY'
      ELSE 'PARKED' END AS status
  FROM app.parking_v516_registrations reg
  WHERE municipality_id=p_mid AND (p_after IS NULL OR id>p_after)
   AND (p_filter='ALL'
        OR (p_filter='PRESENT' AND manual_exit_at IS NULL AND entry_at<=clock_timestamp())
        OR (p_filter='OVERDUE' AND manual_exit_at IS NULL AND paid_until<clock_timestamp())
        OR (p_filter='EXITED' AND manual_exit_at IS NOT NULL)
        OR (p_filter='DUE_TODAY' AND manual_exit_at IS NULL
            AND paid_until>=clock_timestamp()
            AND (paid_until AT TIME ZONE 'America/Fortaleza')::date=
             (clock_timestamp() AT TIME ZONE 'America/Fortaleza')::date))
  ORDER BY id LIMIT p_limit
 ) r;
 RETURN jsonb_build_object('items',out_json);
END $$;

-- Agregados por municipio; receita bruta apenas dos pagamentos REGISTRADOS
-- pelo atendente. Não implicam integração com banco, Pix, cartão ou estorno.
CREATE FUNCTION app.parking_v516_admin_summary(
 p_mid uuid,p_session_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,pg_temp AS $$
DECLARE counted record; money record;
BEGIN
 PERFORM app.parking_v516_actor(p_mid,p_session_hash);
 SELECT
  count(*) FILTER (WHERE manual_exit_at IS NULL AND entry_at<=clock_timestamp())::integer AS occupied,
  count(*) FILTER (WHERE manual_exit_at IS NULL AND entry_at>clock_timestamp())::integer AS upcoming,
  count(*) FILTER (WHERE manual_exit_at IS NULL AND paid_until<clock_timestamp())::integer AS overdue,
  count(*) FILTER (WHERE manual_exit_at IS NULL
    AND paid_until>=clock_timestamp()
    AND (paid_until AT TIME ZONE 'America/Fortaleza')::date=
     (clock_timestamp() AT TIME ZONE 'America/Fortaleza')::date)::integer AS due_today,
  count(*) FILTER (WHERE manual_exit_at IS NOT NULL)::integer AS exited,
  count(*)::integer AS total_registrations
  INTO counted FROM app.parking_v516_registrations WHERE municipality_id=p_mid;
 SELECT coalesce(sum(amount_cents),0)::bigint AS received_cents,
  count(*)::integer AS payment_movements
  INTO money FROM app.parking_v516_movements WHERE municipality_id=p_mid;
 RETURN jsonb_build_object(
  'occupied',counted.occupied,'upcoming',counted.upcoming,
  'overdue',counted.overdue,'dueToday',counted.due_today,
  'exited',counted.exited,'totalRegistrations',counted.total_registrations,
  'receivedCents',money.received_cents,
  'paymentMovements',money.payment_movements,
  'refundsIncluded',false,'paymentGatewayConnected',false);
END $$;
REVOKE ALL ON FUNCTION
 app.parking_v516_admin_list(uuid,text,uuid,integer,text),
 app.parking_v516_admin_summary(uuid,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 app.parking_v516_admin_list(uuid,text,uuid,integer,text),
 app.parking_v516_admin_summary(uuid,text)
 TO jeriflow_app;
