-- ============================================================
-- 58 · delivery_claims — reclamos + suspensión del chofer
-- ============================================================
-- Anexo Higo Envíos v2, Fase E5.
--
-- Modelo de negocio: Higo NO reembolsa con caja propia. Resolución
-- a favor del remitente = suspender chofer + entregar al remitente
-- los datos identificatorios del chofer para vía legal civil/penal.

BEGIN;

-- 1. Columnas de suspensión en profiles (si no existen)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason  TEXT;

CREATE INDEX IF NOT EXISTS profiles_suspended_idx
  ON public.profiles (suspended_at)
  WHERE suspended_at IS NOT NULL;

-- 2. Tabla de claims
CREATE TABLE IF NOT EXISTS public.delivery_claims (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id                   UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  claimant_id               UUID NOT NULL REFERENCES auth.users(id),
  type                      TEXT NOT NULL,
  description               TEXT,
  evidence_urls             JSONB DEFAULT '[]'::jsonb,
  declared_value_usd        NUMERIC(10,2),
  status                    TEXT NOT NULL DEFAULT 'open',
  admin_resolution_note     TEXT,
  driver_contact_shared     BOOLEAN DEFAULT false,
  driver_contact_shared_at  TIMESTAMPTZ,
  resolved_by               UUID REFERENCES auth.users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at               TIMESTAMPTZ,
  CONSTRAINT delivery_claims_type_check
    CHECK (type IN ('not_delivered','damaged','lost','wrong_recipient')),
  CONSTRAINT delivery_claims_status_check
    CHECK (status IN ('open','investigating','resolved_for_claimant','rejected'))
);

CREATE INDEX IF NOT EXISTS delivery_claims_status_idx
  ON public.delivery_claims (status, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_claims_ride_idx
  ON public.delivery_claims (ride_id);

ALTER TABLE public.delivery_claims ENABLE ROW LEVEL SECURITY;

-- INSERT: solo el remitente del ride, dentro de 48h post-delivered
DROP POLICY IF EXISTS delivery_claims_insert ON public.delivery_claims;
CREATE POLICY delivery_claims_insert
ON public.delivery_claims FOR INSERT
TO authenticated
WITH CHECK (
  claimant_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = ride_id
       AND r.user_id = auth.uid()
       AND r.service_type = 'delivery'
       AND r.delivered_at IS NOT NULL
       AND r.delivered_at > NOW() - INTERVAL '48 hours'
  )
);

-- SELECT: claimant, chofer involucrado, admin
DROP POLICY IF EXISTS delivery_claims_select ON public.delivery_claims;
CREATE POLICY delivery_claims_select
ON public.delivery_claims FOR SELECT
TO authenticated
USING (
  claimant_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = delivery_claims.ride_id AND r.driver_id = auth.uid()
  )
  OR public.is_admin(auth.uid())
);

-- UPDATE: solo admin (resolución)
DROP POLICY IF EXISTS delivery_claims_update ON public.delivery_claims;
CREATE POLICY delivery_claims_update
ON public.delivery_claims FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- 3. RPC para que el admin resuelva un claim a favor del remitente.
--    Atómico: marca status, suspende chofer, registra timestamp del
--    handoff de datos. El email se dispara desde el frontend admin
--    contra send-claim-resolution-email.php.
CREATE OR REPLACE FUNCTION public.resolve_delivery_claim_for_claimant(
  p_claim_id UUID,
  p_admin_note TEXT
)
RETURNS UUID -- driver_id suspendido
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_driver_id UUID;
  v_claim_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT public.is_admin(v_admin_id) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Suspender al chofer y marcar el claim resuelto en una transacción.
  UPDATE public.delivery_claims c
     SET status = 'resolved_for_claimant',
         admin_resolution_note = p_admin_note,
         driver_contact_shared = true,
         driver_contact_shared_at = NOW(),
         resolved_by = v_admin_id,
         resolved_at = NOW()
   WHERE c.id = p_claim_id
   RETURNING (
     SELECT r.driver_id FROM public.rides r WHERE r.id = c.ride_id
   ) INTO v_driver_id;

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'claim_not_found_or_no_driver';
  END IF;

  UPDATE public.profiles
     SET suspended_at = NOW(),
         suspended_reason = 'delivery_claim_' || p_claim_id::text
   WHERE id = v_driver_id
     AND suspended_at IS NULL;

  RETURN v_driver_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_delivery_claim_for_claimant(UUID, TEXT)
  TO authenticated;

-- 4. RPC para rechazar claim
CREATE OR REPLACE FUNCTION public.reject_delivery_claim(
  p_claim_id UUID,
  p_admin_note TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE public.delivery_claims
     SET status = 'rejected',
         admin_resolution_note = p_admin_note,
         resolved_by = auth.uid(),
         resolved_at = NOW()
   WHERE id = p_claim_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_delivery_claim(UUID, TEXT) TO authenticated;

COMMIT;
