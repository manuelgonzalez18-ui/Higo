-- ============================================================
-- 67 · indices para cursor pagination en admin pages (H4.1)
-- ============================================================
-- Fase H4 del Anexo B (Hardening de Producción).
--
-- Sin estos indices, `ORDER BY created_at DESC LIMIT 50` sobre tablas
-- con 10k+ rows hace Seq Scan -> tiempos de carga >5s + alto IO en
-- Supabase. Con indices DESC sobre created_at, EXPLAIN muestra
-- "Index Scan Backward" en <50ms.
--
-- Las migraciones 12 (add_indices) y 44 (fraud_signals) crearon
-- algunos indices, pero NO uno descendente sobre profiles.created_at
-- ni sobre rides.created_at filtrado por service_type. Acá los
-- agregamos donde faltan.
--
-- IF NOT EXISTS en todas para que la re-corrida sea idempotente.

BEGIN;

-- Para AdminUsersPage y AdminDriversPage (cursor sobre profiles).
-- created_at DESC es lo que usa la query `.order('created_at', desc).limit(50)`.
CREATE INDEX IF NOT EXISTS profiles_created_at_desc_idx
    ON public.profiles (created_at DESC);

-- Optimiza el filtro por rol cuando la query es:
-- WHERE role = 'driver' ORDER BY created_at DESC LIMIT 50
CREATE INDEX IF NOT EXISTS profiles_role_created_at_idx
    ON public.profiles (role, created_at DESC);

-- AdminDeliveriesPage ya tenia rides_service_type_created_at_idx (mig 49)
-- que cubre (service_type, created_at DESC). Reverificar.
-- No-op si ya existe.
CREATE INDEX IF NOT EXISTS rides_service_type_created_at_desc_idx
    ON public.rides (service_type, created_at DESC);

-- fraud_signals (mig 44) es vista materializada. El refresh se hace
-- via RPC refresh_fraud_signals. Aca no agregamos indice porque la MV
-- se relee entera en cada call; la paginacion va a ser client-side.

COMMIT;
