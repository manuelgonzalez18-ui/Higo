-- ============================================================
-- 49 · rides.service_type — persistir si es viaje o envío
-- ============================================================
-- Anexo Higo Envíos v2, Fase E1.1.
--
-- El frontend (ConfirmTripPage.jsx) ya estaba insertando `service_type`
-- y `delivery_info` pero las columnas nunca se crearon en la DB. Esta
-- migración formaliza ambas + un índice para queries de admin/analytics.
--
-- Idempotente: usa IF NOT EXISTS y backfill no destructivo.

BEGIN;

-- 1. Columnas: service_type (ride|delivery) + delivery_info (JSONB con
--    senderName, senderPhone, receiverName, receiverPhone, instructions,
--    package_description, package_weight_kg, package_value_usd, is_fragile,
--    category, terms_version, terms_accepted_at, etc.)
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'ride',
  ADD COLUMN IF NOT EXISTS delivery_info JSONB,
  ADD COLUMN IF NOT EXISTS payer TEXT;

-- 2. CHECK constraint (drop+add para idempotencia)
ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_service_type_check;
ALTER TABLE public.rides
  ADD CONSTRAINT rides_service_type_check
  CHECK (service_type IN ('ride','delivery'));

ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_payer_check;
ALTER TABLE public.rides
  ADD CONSTRAINT rides_payer_check
  CHECK (payer IS NULL OR payer IN ('sender','receiver'));

-- 3. Backfill: rides con delivery_info != NULL son envíos (heurística)
UPDATE public.rides
   SET service_type = 'delivery'
 WHERE delivery_info IS NOT NULL
   AND service_type = 'ride';

-- 4. Index para filtros de admin/analytics
CREATE INDEX IF NOT EXISTS rides_service_type_created_at_idx
  ON public.rides (service_type, created_at DESC);

COMMIT;
