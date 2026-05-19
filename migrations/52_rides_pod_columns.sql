-- ============================================================
-- 52 · rides — URLs de POD pickup y delivery
-- ============================================================
-- Anexo Higo Envíos v2, Fase E1.3 (segunda parte).
--
-- Guardamos la ruta dentro del bucket delivery-pods. Para servir las
-- fotos al frontend se generan signed URLs con la API de Supabase.

BEGIN;

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS pickup_pod_url  TEXT,
  ADD COLUMN IF NOT EXISTS delivery_pod_url TEXT;

COMMENT ON COLUMN public.rides.pickup_pod_url IS
  'Path en bucket delivery-pods: <ride_id>/pickup.jpg';
COMMENT ON COLUMN public.rides.delivery_pod_url IS
  'Path en bucket delivery-pods: <ride_id>/delivery.jpg';

COMMIT;
