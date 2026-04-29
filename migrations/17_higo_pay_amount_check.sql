-- ============================================================
-- 17 · Higo Pay — defensa de monto en register_membership_payment
-- ============================================================
-- Cierra un bypass: el RPC original confiaba ciegamente en lo
-- que pasaba el cliente (p_amount_real). Aunque el endpoint
-- banesco-validate.php ya valida server-side contra el plan,
-- duplicamos la regla acá como defensa en profundidad: no se
-- puede activar una membresía con un pago significativamente
-- menor al precio guardado en membership_plans.
--
-- Margen del 5% para tolerar fluctuaciones BCV entre el momento
-- en que se calculó membership_plans.amount_bs y el momento en
-- que el conductor pagó. Si amount_bs es null o 0, no se aplica
-- (la validación queda solamente en el endpoint PHP).
--
-- Idempotente: CREATE OR REPLACE FUNCTION.
-- ============================================================

CREATE OR REPLACE FUNCTION public.register_membership_payment(
    p_bank_origin     TEXT,
    p_reference_last6 TEXT,
    p_sender_phone    TEXT,
    p_amount_reported NUMERIC,
    p_amount_real     NUMERIC,
    p_trn_date        DATE,
    p_banesco_status  TEXT,
    p_raw_response    JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_driver        UUID := auth.uid();
    v_plan          TEXT;
    v_period        TEXT;
    v_plan_bs       NUMERIC;
    v_membership_id BIGINT;
    v_report_id     BIGINT;
    v_expires       TIMESTAMPTZ;
BEGIN
    IF v_driver IS NULL THEN
        RAISE EXCEPTION 'no auth' USING ERRCODE = '28000';
    END IF;

    IF p_amount_real IS NULL OR p_amount_real <= 0 THEN
        RAISE EXCEPTION 'amount_real inválido' USING ERRCODE = '22023';
    END IF;

    -- Plan tomado de profiles.vehicle_model; default 'standard'.
    SELECT CASE
               WHEN COALESCE(NULLIF(vehicle_model,''), '') IN ('moto','standard','van')
               THEN vehicle_model
               ELSE 'standard'
           END
      INTO v_plan
      FROM public.profiles
     WHERE id = v_driver;

    SELECT period, amount_bs
      INTO v_period, v_plan_bs
      FROM public.membership_plans
     WHERE plan = v_plan;
    IF v_period IS NULL THEN v_period := 'monthly'; END IF;

    -- Defensa de monto: si tenemos un precio de referencia en BS, exigimos
    -- al menos el 95% del mismo. La capa PHP ya hace la comparación con
    -- la tasa BCV en vivo; este check es por si alguien llama el RPC
    -- directo o si la capa PHP tiene un bug.
    IF v_plan_bs IS NOT NULL AND v_plan_bs > 0
       AND p_amount_real < v_plan_bs * 0.95 THEN
        RAISE EXCEPTION 'monto insuficiente: % Bs < % Bs (95%% de %)',
                        p_amount_real, v_plan_bs * 0.95, v_plan_bs
              USING ERRCODE = '22023';
    END IF;

    v_expires := CASE v_period
        WHEN 'weekly'  THEN NOW() + INTERVAL '7 days'
        WHEN 'monthly' THEN NOW() + INTERVAL '30 days'
        WHEN 'yearly'  THEN NOW() + INTERVAL '365 days'
    END;

    INSERT INTO public.driver_memberships
        (driver_id, plan, amount, period, payment_method, reference, paid_at, expires_at, status)
    VALUES
        (v_driver, v_plan, p_amount_real, v_period, 'banesco',
         p_reference_last6, NOW(), v_expires, 'active')
    RETURNING id INTO v_membership_id;

    INSERT INTO public.payment_reports
        (driver_id, bank_origin, reference_last6, sender_phone,
         amount_reported, amount_real, trn_date,
         banesco_status, status, membership_id, raw_response)
    VALUES
        (v_driver, p_bank_origin, p_reference_last6, p_sender_phone,
         p_amount_reported, p_amount_real, p_trn_date,
         p_banesco_status, 'validated', v_membership_id, p_raw_response)
    RETURNING id INTO v_report_id;

    RETURN jsonb_build_object(
        'membership_id', v_membership_id,
        'report_id',     v_report_id,
        'expires_at',    v_expires
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_membership_payment(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, JSONB
) TO authenticated;
