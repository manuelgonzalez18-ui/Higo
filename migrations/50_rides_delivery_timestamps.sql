-- ============================================================
-- 50 · rides — timestamps granulares de envío
-- ============================================================
-- Anexo Higo Envíos v2, Fase E1.2.
--
-- Permite medir tiempo pickup→delivery, SLA, KPIs reales en analytics.
-- Triggers automáticos en transiciones de status, solo para envíos.

BEGIN;

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at_dropoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Trigger: setear timestamps automáticamente al cambiar status en envíos
CREATE OR REPLACE FUNCTION public.set_delivery_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.service_type <> 'delivery' THEN
    RETURN NEW;
  END IF;

  -- accepted → in_progress (chofer recogió el paquete)
  IF NEW.status = 'in_progress' AND OLD.status = 'accepted'
     AND NEW.picked_up_at IS NULL THEN
    NEW.picked_up_at := NOW();
  END IF;

  -- in_progress/picked_up → arrived_at_dropoff (llegó al destino)
  IF NEW.status = 'arrived_at_dropoff'
     AND NEW.arrived_at_dropoff_at IS NULL THEN
    NEW.arrived_at_dropoff_at := NOW();
  END IF;

  -- * → completed (entregado)
  IF NEW.status = 'completed' AND OLD.status <> 'completed'
     AND NEW.delivered_at IS NULL THEN
    NEW.delivered_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_set_delivery_timestamps ON public.rides;
CREATE TRIGGER rides_set_delivery_timestamps
  BEFORE UPDATE ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.set_delivery_timestamps();

-- Index para analytics de SLA
CREATE INDEX IF NOT EXISTS rides_delivered_at_idx
  ON public.rides (delivered_at DESC)
  WHERE service_type = 'delivery';

COMMIT;
