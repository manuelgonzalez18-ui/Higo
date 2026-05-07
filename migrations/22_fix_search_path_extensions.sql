-- ============================================================
-- 22 · Fix search_path: incluir extensions para PostGIS
-- ============================================================
-- PostGIS está instalado en el schema "extensions" de Supabase.
-- Las funciones SECURITY DEFINER con SET search_path = public
-- no ven el tipo geography cuando lo necesitan (por ejemplo, si
-- hay un trigger en profiles que usa PostGIS heredando el search_path).
-- Agregamos "extensions" a todas las funciones de la cadena de pago.
-- ============================================================

-- 1. driver_has_active_membership
CREATE OR REPLACE FUNCTION public.driver_has_active_membership(p_driver_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.driver_memberships
        WHERE driver_id = p_driver_id
          AND status = 'active'
          AND expires_at > NOW()
    );
$$;

GRANT EXECUTE ON FUNCTION public.driver_has_active_membership(UUID) TO authenticated;

-- 2. sync_driver_subscription_status (trigger)
CREATE OR REPLACE FUNCTION public.sync_driver_subscription_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    UPDATE public.profiles
       SET subscription_status = CASE
               WHEN public.driver_has_active_membership(NEW.driver_id) THEN 'active'
               ELSE 'suspended'
           END,
           last_payment_date = NEW.paid_at
     WHERE id = NEW.driver_id;
    RETURN NEW;
END;
$$;

-- 3. register_membership_payment
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
SET search_path = public, extensions
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

-- 4. is_within_coverage (prevención, por si acaso)
CREATE OR REPLACE FUNCTION public.is_within_coverage(p_lat float8, p_lng float8)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.coverage_zones
        WHERE active = TRUE
          AND 2 * 6371 * asin(sqrt(
              power(sin(radians((center_lat - p_lat) / 2)), 2)
              + cos(radians(p_lat)) * cos(radians(center_lat))
              * power(sin(radians((center_lng - p_lng) / 2)), 2)
          )) <= radius_km
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_within_coverage(float8, float8) TO authenticated;
