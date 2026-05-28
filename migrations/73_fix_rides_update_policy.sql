-- ============================================================
-- 73 · Fix policy UPDATE de `rides` sin restricción de fila
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
-- Fix:
-- Una policy granular por transición legítima del estado del ride.
-- Cada transición tiene su propio USING (qué fila puede modificar) y su
-- WITH CHECK (qué valores puede dejar). Lo no cubierto queda bloqueado.
--
-- Transiciones permitidas a un driver:
--   1) requested → accepted   (driver acepta — se asigna a sí mismo)
--   2) accepted  → in_progress (driver inicia el viaje)
--   3) in_progress → completed (driver completa el viaje)
--   4) accepted/in_progress → cancelled (driver cancela por motivos válidos)
--
-- Pasajero: tiene su propia policy aparte (no se toca aquí; ver mig 64).
-- Admin: tiene policy admin separada vía is_admin().
--
-- IMPORTANTE: si el código del cliente hace updates fuera de estas
-- transiciones (ej. update parcial de algún campo) van a ser rechazados.
-- Revisar src/features/driver/ y src/stores/rideStore.js antes de aplicar.
--
-- Rollback: restaurar la policy original con solo USING (mig 65).

BEGIN;

-- Limpiar variantes previas
DROP POLICY IF EXISTS "Drivers can update rides to accept" ON public.rides;
DROP POLICY IF EXISTS "rides_driver_accept" ON public.rides;
DROP POLICY IF EXISTS "rides_driver_start" ON public.rides;
DROP POLICY IF EXISTS "rides_driver_complete" ON public.rides;
DROP POLICY IF EXISTS "rides_driver_cancel" ON public.rides;
DROP POLICY IF EXISTS "rides_admin_update" ON public.rides;

-- 1) Aceptar: requested + driver_id NULL → accepted + driver_id = me
CREATE POLICY "rides_driver_accept"
ON public.rides FOR UPDATE TO authenticated
USING (
    public.is_driver(auth.uid())
    AND status = 'requested'
    AND driver_id IS NULL
)
WITH CHECK (
    driver_id = auth.uid()
    AND status = 'accepted'
);

-- 2) Iniciar: accepted + driver_id = me → in_progress (mismo driver)
CREATE POLICY "rides_driver_start"
ON public.rides FOR UPDATE TO authenticated
USING (
    public.is_driver(auth.uid())
    AND driver_id = auth.uid()
    AND status = 'accepted'
)
WITH CHECK (
    driver_id = auth.uid()
    AND status = 'in_progress'
);

-- 3) Completar: in_progress + driver_id = me → completed (mismo driver)
CREATE POLICY "rides_driver_complete"
ON public.rides FOR UPDATE TO authenticated
USING (
    public.is_driver(auth.uid())
    AND driver_id = auth.uid()
    AND status = 'in_progress'
)
WITH CHECK (
    driver_id = auth.uid()
    AND status = 'completed'
);

-- 4) Cancelar: accepted o in_progress + driver_id = me → cancelled
CREATE POLICY "rides_driver_cancel"
ON public.rides FOR UPDATE TO authenticated
USING (
    public.is_driver(auth.uid())
    AND driver_id = auth.uid()
    AND status IN ('accepted', 'in_progress')
)
WITH CHECK (
    driver_id = auth.uid()
    AND status = 'cancelled'
);

-- 5) Admin override: pueden tocar lo que sea (panel de soporte/fraude).
CREATE POLICY "rides_admin_update"
ON public.rides FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

COMMIT;

-- ── Verificación manual sugerida tras aplicar ────────────────────────
-- Como driver A:
--   1) Crear ride como pasajero (otra sesión).
--   2) Aceptar (debe funcionar): status='requested' → 'accepted', driver_id=A.
--   3) Intentar robarlo con driver B autenticado:
--        UPDATE rides SET driver_id=B WHERE id=<ride_id>;
--      → debe devolver 0 filas afectadas (WITH CHECK rechaza).
--   4) Intentar cambiar price desde driver A:
--        UPDATE rides SET price=0 WHERE id=<ride_id>;
--      → WITH CHECK exige status='accepted' (sin cambiar más), price tampoco
--        está permitido cambiar por driver — actualización completa rechazada.
