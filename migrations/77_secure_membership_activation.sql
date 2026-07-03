-- ============================================================
-- 77 · Cerrar bypass de pago de membresías (driver + tienda)
-- ============================================================
--
-- Problema (auditoría profunda 2026-07-02, C1 + C2):
-- register_membership_payment (mig 16/17) y
-- register_store_membership_payment (mig 71) son SECURITY DEFINER y
-- estaban otorgadas a `authenticated`. Insertan la membresía como
-- 'active' confiando en p_amount_real / p_banesco_status que manda el
-- cliente, y NUNCA verifican la referencia contra Banesco (eso solo lo
-- hace public/api/banesco-validate.php). Por lo tanto cualquier
-- driver/comercio autenticado podía ejecutar la RPC directo con la anon
-- key pasando el monto correcto y auto-activarse la membresía SIN pagar:
--
--   supabase.rpc('register_membership_payment', { p_amount_real: <precio>,
--       p_banesco_status: '200', p_reference_last6: '<aleatorio>', ... })
--
-- El piso de precio del 95% (mig 17) tampoco protege: el seed deja
-- membership_plans.amount_bs = NULL, así que el check se saltaba; y aun
-- con precio, el atacante simplemente pasa el monto correcto.
--
-- Fix:
-- La activación deja de estar expuesta al cliente. Ahora SOLO el servidor
-- de confianza (banesco-validate.php, que es el único que habla con
-- Banesco) invoca estas RPC, usando SUPABASE_SERVICE_ROLE_KEY, después de
-- confirmar el abono real. Para eso:
--   1. Se añade un parámetro server-side (p_driver_id / p_caller_id) que
--      SOLO el service_role puede setear; para el cliente auth.uid() sigue
--      siendo la fuente (COALESCE), pero el cliente ya no tiene EXECUTE.
--   2. Se revoca EXECUTE de PUBLIC/anon/authenticated y se concede solo a
--      service_role.
-- Como añadir un parámetro cambia la firma (crea una sobrecarga nueva en
-- vez de reemplazar), se hace DROP de la firma vieja + CREATE de la nueva.
--
-- Idempotente. Rollback al final.
-- ============================================================

BEGIN;

-- ── register_membership_payment (driver) ────────────────────────────
-- Reproduce el cuerpo vigente (mig 17, con la defensa de monto del 95%)
-- añadiendo p_driver_id para invocación server-side.
DROP FUNCTION IF EXISTS public.register_membership_payment(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, JSONB
);

CREATE FUNCTION public.register_membership_payment(
    p_bank_origin     TEXT,
    p_reference_last6 TEXT,
    p_sender_phone    TEXT,
    p_amount_reported NUMERIC,
    p_amount_real     NUMERIC,
    p_trn_date        DATE,
    p_banesco_status  TEXT,
    p_raw_response    JSONB,
    p_driver_id       UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_driver        UUID := COALESCE(auth.uid(), p_driver_id);
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

    -- Defensa de monto (mig 17): si hay precio de referencia en BS, exigir
    -- al menos 95%. banesco-validate.php ya compara contra la tasa BCV viva.
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

REVOKE EXECUTE ON FUNCTION public.register_membership_payment(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_membership_payment(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, JSONB, UUID
) TO service_role;

-- ── register_store_membership_payment (tienda) ──────────────────────
-- Reproduce el cuerpo de mig 71 añadiendo p_caller_id server-side.
DROP FUNCTION IF EXISTS public.register_store_membership_payment(
    UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, JSONB
);

CREATE FUNCTION public.register_store_membership_payment(
    p_store_id        UUID,
    p_bank_origin     TEXT,
    p_reference_last6 TEXT,
    p_sender_phone    TEXT,
    p_amount_reported NUMERIC,
    p_amount_real     NUMERIC,
    p_trn_date        DATE,
    p_banesco_status  TEXT,
    p_raw_response    JSONB,
    p_caller_id       UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid             UUID := COALESCE(auth.uid(), p_caller_id);
    v_owner           UUID;
    v_membership_id   BIGINT;
    v_current_expires TIMESTAMPTZ;
    v_expires         TIMESTAMPTZ;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'no auth' USING ERRCODE = '28000';
    END IF;

    SELECT owner_id INTO v_owner FROM public.stores WHERE id = p_store_id;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'tienda no encontrada' USING ERRCODE = '42704';
    END IF;

    IF v_owner <> v_uid AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'no autorizado para esta tienda' USING ERRCODE = '42501';
    END IF;

    IF p_amount_real IS NULL OR p_amount_real <= 0 THEN
        RAISE EXCEPTION 'amount_real inválido' USING ERRCODE = '22023';
    END IF;

    SELECT expires_at INTO v_current_expires
    FROM public.store_memberships
    WHERE store_id = p_store_id AND status = 'active' AND expires_at > NOW()
    ORDER BY expires_at DESC
    LIMIT 1;

    IF v_current_expires IS NOT NULL THEN
        v_expires := v_current_expires + INTERVAL '30 days';
    ELSE
        v_expires := NOW() + INTERVAL '30 days';
    END IF;

    INSERT INTO public.store_memberships (
        store_id, amount, payment_method, reference, status, paid_at, expires_at, notes,
        bank_origin, sender_phone, raw_response
    ) VALUES (
        p_store_id, p_amount_real, 'pago_movil', p_reference_last6, 'active', NOW(), v_expires,
        'Pago móvil Banesco validado automáticamente.', p_bank_origin, p_sender_phone, p_raw_response
    )
    RETURNING id INTO v_membership_id;

    RETURN jsonb_build_object(
        'membership_id', v_membership_id,
        'expires_at',    v_expires
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_store_membership_payment(
    UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_store_membership_payment(
    UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, JSONB, UUID
) TO service_role;

COMMIT;

-- ============================================================
-- Rollback (revierte a la exposición anterior — NO recomendado):
-- ============================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.register_membership_payment(
--     TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, JSONB, UUID);
-- DROP FUNCTION IF EXISTS public.register_store_membership_payment(
--     UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, JSONB, UUID);
-- -- luego re-aplicar migrations/17 y migrations/71 para recrear las
-- -- firmas viejas con GRANT a authenticated.
-- COMMIT;
