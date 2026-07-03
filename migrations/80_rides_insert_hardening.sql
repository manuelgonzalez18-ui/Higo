-- ============================================================
-- 80 · Restringir INSERT de rides (anti-suplantación)
-- ============================================================
--
-- Problema (auditoría profunda 2026-07-02, M1):
-- El schema inicial (supabase_schema.sql, hoy en migrations/_legacy/)
-- creó la policy "Users can insert their own rides" con
-- `WITH CHECK (true)` y ninguna migración numerada la reemplazó. En la
-- base de producción eso permite a cualquier autenticado insertar rides
-- con `user_id`/`driver_id`/`price`/`status` arbitrarios: suplantar a
-- otro pasajero, pre-asignarse como driver de un ride, o spamear
-- solicitudes con precio manipulado.
--
-- Fix:
-- Reemplazar la policy por una que exija que el ride sea del propio
-- usuario, sin driver pre-asignado y en el estado inicial 'requested'.
-- Verificado en el frontend: el único INSERT de rides
-- (src/pages/ConfirmTripPage.jsx) crea exactamente así (user_id del
-- auth user, status 'requested', sin driver_id) → no rompe el flujo.
--
-- Idempotente. Rollback al final.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "Users can insert their own rides" ON public.rides;
DROP POLICY IF EXISTS "rides_insert_own" ON public.rides;

CREATE POLICY "rides_insert_own"
ON public.rides
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND driver_id IS NULL
    AND status = 'requested'
);

COMMIT;

-- ── Verificación manual sugerida tras aplicar ────────────────────────
-- Crear un ride normal desde la app (ConfirmTripPage) debe seguir
-- funcionando. Un INSERT con user_id de otro, o driver_id preasignado, o
-- status != 'requested' debe ser rechazado por el WITH CHECK.
--
-- ============================================================
-- Rollback (vuelve al INSERT laxo — NO recomendado):
-- ============================================================
-- BEGIN;
-- DROP POLICY IF EXISTS "rides_insert_own" ON public.rides;
-- CREATE POLICY "Users can insert their own rides" ON public.rides
--   FOR INSERT WITH CHECK (true);
-- COMMIT;
