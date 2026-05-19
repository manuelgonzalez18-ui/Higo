-- ============================================================
-- 56 · delivery_receipts — comprobantes de envío
-- ============================================================
-- Anexo Higo Envíos v2, Fase E4.2.
--
-- Cada envío completado genera un receipt con número correlativo y
-- (eventualmente) un PDF en bucket. La generación del PDF la dispara
-- un endpoint PHP que escucha el INSERT vía webhook (o el frontend al
-- abrir la pantalla de detalle, lazy).
--
-- Modelo paralelo a payment_receipts (mig 21).

BEGIN;

CREATE TABLE IF NOT EXISTS public.delivery_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id         UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  receipt_number  BIGSERIAL UNIQUE,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_url         TEXT,
  total_amount    NUMERIC(10,2),
  cod_amount      NUMERIC(10,2),
  currency        CHAR(3) DEFAULT 'USD',
  UNIQUE (ride_id)
);

ALTER TABLE public.delivery_receipts ENABLE ROW LEVEL SECURITY;

-- SELECT: remitente, chofer asignado, admin
DROP POLICY IF EXISTS delivery_receipts_select ON public.delivery_receipts;
CREATE POLICY delivery_receipts_select
ON public.delivery_receipts FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = delivery_receipts.ride_id
       AND (r.user_id = auth.uid() OR r.driver_id = auth.uid())
  )
  OR public.is_admin(auth.uid())
);

-- INSERT: el trigger lo hace; lo bloqueamos para clientes.
DROP POLICY IF EXISTS delivery_receipts_insert ON public.delivery_receipts;
CREATE POLICY delivery_receipts_insert
ON public.delivery_receipts FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

-- Trigger: al completar un envío crea el receipt automáticamente
CREATE OR REPLACE FUNCTION public.create_delivery_receipt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.service_type = 'delivery'
     AND NEW.status = 'completed'
     AND OLD.status <> 'completed' THEN
    INSERT INTO public.delivery_receipts (ride_id, total_amount, cod_amount, currency)
    VALUES (NEW.id, NEW.price, NEW.cod_amount, COALESCE(NEW.cod_currency, 'USD'))
    ON CONFLICT (ride_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_create_delivery_receipt ON public.rides;
CREATE TRIGGER rides_create_delivery_receipt
  AFTER UPDATE ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.create_delivery_receipt();

CREATE INDEX IF NOT EXISTS delivery_receipts_ride_id_idx
  ON public.delivery_receipts (ride_id);

COMMIT;
