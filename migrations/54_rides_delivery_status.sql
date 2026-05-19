-- ============================================================
-- 54 · Extender status para envíos (arrived_at_dropoff)
-- ============================================================
-- Anexo Higo Envíos v2, Fase E3.1.
--
-- Hoy status IN ('requested','accepted','in_progress','completed','cancelled').
-- Para envíos sumamos 'arrived_at_dropoff' (entre in_progress y completed).
-- Para viajes normales el flujo no cambia.

BEGIN;

-- Drop el CHECK viejo del status y volver a crearlo extendido
ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_status_check;
ALTER TABLE public.rides
  ADD CONSTRAINT rides_status_check
  CHECK (status IN (
    'requested',
    'accepted',
    'in_progress',
    'arrived_at_dropoff',
    'completed',
    'cancelled'
  ));

COMMIT;
