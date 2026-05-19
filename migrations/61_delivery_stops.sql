-- ============================================================
-- 61 · delivery_stops — multi-stop deliveries
-- ============================================================
-- Anexo Higo Envíos v2, Fase E7.1.
--
-- Cada parada de un envío multi-destino con datos del destinatario
-- y su propio POD.

BEGIN;

CREATE TABLE IF NOT EXISTS public.delivery_stops (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id             UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  stop_order          INT NOT NULL,
  recipient_name      TEXT NOT NULL,
  recipient_phone     TEXT,
  address             TEXT NOT NULL,
  lat                 NUMERIC,
  lng                 NUMERIC,
  package_description TEXT,
  instructions        TEXT,
  delivered_at        TIMESTAMPTZ,
  pod_url             TEXT,
  cod_amount          NUMERIC(10,2),
  cod_collected       BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ride_id, stop_order)
);

CREATE INDEX IF NOT EXISTS delivery_stops_ride_idx
  ON public.delivery_stops (ride_id, stop_order);

ALTER TABLE public.delivery_stops ENABLE ROW LEVEL SECURITY;

-- SELECT/UPDATE: remitente, chofer asignado, admin
DROP POLICY IF EXISTS delivery_stops_select ON public.delivery_stops;
CREATE POLICY delivery_stops_select
ON public.delivery_stops FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = ride_id
       AND (r.user_id = auth.uid() OR r.driver_id = auth.uid())
  )
  OR public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS delivery_stops_insert ON public.delivery_stops;
CREATE POLICY delivery_stops_insert
ON public.delivery_stops FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = ride_id AND r.user_id = auth.uid()
  )
);

-- UPDATE: solo chofer asignado (para marcar delivered + pod) o admin
DROP POLICY IF EXISTS delivery_stops_update ON public.delivery_stops;
CREATE POLICY delivery_stops_update
ON public.delivery_stops FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = ride_id AND r.driver_id = auth.uid()
  )
  OR public.is_admin(auth.uid())
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = ride_id AND r.driver_id = auth.uid()
  )
  OR public.is_admin(auth.uid())
);

COMMIT;
