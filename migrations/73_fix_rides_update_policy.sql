-- ============================================================
-- 73 · Fix policy UPDATE de `rides` sin restricción de fila (v2)
-- ============================================================
--
-- Problema (auditoría automática #4, issue #44):
-- La policy "Drivers can update rides to accept" (mig 65) solo verifica
-- `public.is_driver(auth.uid())` en USING — no restringe driver_id ni
-- status, y no tiene WITH CHECK. Cualquier driver autenticado puede:
--
--   - Robarse rides aceptados por otro driver:
--       UPDATE rides SET driver_id = me, status = 'accepted' WHERE id = ?
--   - Modificar tarifas de viajes de otros drivers (afecta payout).
--   - Marcar como completados/cancelados rides ajenos.
--   - Cambiar pickup/dropoff post-aceptación.
--
-- ── Por qué v2 ─────────────────────────────────────────────────────────
-- La v1 (4 policies por transición de estado con WITH CHECK estricto)
-- rompía dos updates legítimos del driver:
--   - useDriverActiveTrip.js L276: escribe wait_seconds/wait_fee/price
--     sin cambiar status (espera en pickup). status sigue 'accepted'.
--   - useDriverActiveTrip.js L359 (confirmDriverPayment): escribe
--     payment_confirmed_by_driver y payment_confirmed_at sin tocar status.
-- Ambos fallaban con la v1 porque cada policy exigía un status target
-- específico en WITH CHECK.
--
-- v2 usa una policy unificada permisiva pero con WITH CHECK que blinda
-- los puntos clave (driver_id propio, status fuera de 'requested').
-- Trade-off: el driver puede escribir cualquier columna de SU ride
-- (price, pickup, etc.), pero no puede tocar rides ajenos ni reciclarlos.
-- Endurecer eso requeriría policies a nivel columna o lógica server-side.
--
-- Pasajero: tiene su propia policy aparte (no se toca aquí; ver mig 64).
-- Admin: cubierto por rides_admin_update (panel disputas, deliveries).
--
-- Rollback: ver bloque al final del archivo.

BEGIN;

-- Limpiar variantes previas
DROP POLICY IF EXISTS "Drivers can update rides to accept" ON public.rides;
DROP POLICY IF EXISTS "rides_driver_accept" ON public.rides;
DROP POLICY IF EXISTS "rides_driver_start" ON public.rides;
DROP POLICY IF EXISTS "rides_driver_complete" ON public.rides;
DROP POLICY IF EXISTS "rides_driver_cancel" ON public.rides;
DROP POLICY IF EXISTS "rides_driver_update" ON public.rides;
DROP POLICY IF EXISTS "rides_admin_update" ON public.rides;

-- Policy unificada del driver: cubre aceptar + todas las actualizaciones
-- sobre rides ya asignados a él (transiciones de estado, wait_fee, price,
-- payment_confirmed_by_driver, etc.). Bloquea:
--   - robar rides de otro driver (USING exige driver_id=me o ride libre)
--   - cambiar driver_id a otro user (WITH CHECK exige driver_id=me final)
--   - volver el ride a 'requested' para que lo agarre otro driver
--     (WITH CHECK excluye 'requested')
CREATE POLICY "rides_driver_update"
ON public.rides FOR UPDATE TO authenticated
USING (
    public.is_driver(auth.uid())
    AND (
        -- Caso 1: aceptar un ride sin driver asignado
        (status = 'requested' AND driver_id IS NULL)
        OR
        -- Caso 2: tocar un ride que ya es mío
        driver_id = auth.uid()
    )
)
WITH CHECK (
    driver_id = auth.uid()
    AND status IN ('accepted', 'in_progress', 'completed', 'cancelled')
);

-- Admin override: panel de soporte/fraude/disputas (AdminDeliveriesPage,
-- AdminDisputesPage hacen updates a price/payment_confirmed_*/status).
CREATE POLICY "rides_admin_update"
ON public.rides FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

COMMIT;

-- ── Verificación manual sugerida tras aplicar ────────────────────────
-- Flujo passenger + driver end-to-end:
--   1) Passenger crea ride desde la web (status='requested').
--   2) Driver A acepta desde el APK (status='accepted', driver_id=A).
--   3) Driver A inicia pickup, esperar (toca wait_fee/price sin cambiar
--      status) → debe funcionar.
--   4) Driver A inicia viaje (status='in_progress') → debe funcionar.
--   5) Driver A completa (status='completed') → debe funcionar.
--   6) Driver A confirma pago (payment_confirmed_by_driver=true sin tocar
--      status) → debe funcionar.
--   7) Como driver B en otra sesión, intentar:
--        UPDATE rides SET driver_id = B WHERE id = <ride_id>;
--      → 0 filas afectadas (WITH CHECK bloquea).
--   8) Como driver A, intentar volver el ride a 'requested':
--        UPDATE rides SET status = 'requested' WHERE id = <ride_id>;
--      → 0 filas afectadas (WITH CHECK excluye 'requested').
--
-- ── Rollback ─────────────────────────────────────────────────────────
-- Si la v2 rompe algún flujo del driver no contemplado:
--   BEGIN;
--   DROP POLICY IF EXISTS "rides_driver_update" ON public.rides;
--   DROP POLICY IF EXISTS "rides_admin_update" ON public.rides;
--   CREATE POLICY "Drivers can update rides to accept"
--   ON public.rides FOR UPDATE TO authenticated
--   USING ( public.is_driver(auth.uid()) );
--   COMMIT;
