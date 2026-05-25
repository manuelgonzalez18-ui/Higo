-- ====================================================================
-- 71 · Higo Shop Register Store Membership Payment RPC Migration
-- ====================================================================
-- This migration implements auditing columns for store memberships
-- and declares a SECURITY DEFINER database function to securely 
-- register validated Banesco Pago Móvil payments.

BEGIN;

-- ====================================================================
-- 1. ADD AUDITING COLUMNS TO STORE_MEMBERSHIPS
-- ====================================================================
ALTER TABLE public.store_memberships 
  ADD COLUMN IF NOT EXISTS receipt_url TEXT,
  ADD COLUMN IF NOT EXISTS bank_origin TEXT,
  ADD COLUMN IF NOT EXISTS sender_phone TEXT,
  ADD COLUMN IF NOT EXISTS raw_response JSONB;

-- ====================================================================
-- 2. CREATE REGISTER STORE MEMBERSHIP RPC FUNCTION
-- ====================================================================
CREATE OR REPLACE FUNCTION public.register_store_membership_payment(
    p_store_id        UUID,
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
    v_uid             UUID := auth.uid();
    v_owner           UUID;
    v_membership_id   BIGINT;
    v_current_expires TIMESTAMPTZ;
    v_expires         TIMESTAMPTZ;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'no auth' USING ERRCODE = '28000';
    END IF;

    -- 1. Fetch and verify store owner
    SELECT owner_id INTO v_owner FROM public.stores WHERE id = p_store_id;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'tienda no encontrada' USING ERRCODE = '42704';
    END IF;

    -- 2. Permit if actual store owner OR a platform Administrator
    IF v_owner <> v_uid AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'no autorizado para esta tienda' USING ERRCODE = '42501';
    END IF;

    IF p_amount_real IS NULL OR p_amount_real <= 0 THEN
        RAISE EXCEPTION 'amount_real inválido' USING ERRCODE = '22023';
    END IF;

    -- 3. Calculate dynamic cumulative expires_at
    SELECT expires_at INTO v_current_expires
    FROM public.store_memberships
    WHERE store_id = p_store_id AND status = 'active' AND expires_at > NOW()
    ORDER BY expires_at DESC
    LIMIT 1;

    IF v_current_expires IS NOT NULL THEN
        -- Additive subscription: Appends 30 days onto existing active subscription
        v_expires := v_current_expires + INTERVAL '30 days';
    ELSE
        -- Fresh subscription: 30 days starting now
        v_expires := NOW() + INTERVAL '30 days';
    END IF;

    -- 4. Insert membership record
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

-- Grant execution privileges
GRANT EXECUTE ON FUNCTION public.register_store_membership_payment(
    UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, JSONB
) TO authenticated;

COMMIT;
