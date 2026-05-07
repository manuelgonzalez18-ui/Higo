-- ============================================================
-- 22 · Fix search_path: incluir extensions para PostGIS
-- ============================================================
-- PostGIS está instalado en el schema "extensions" de Supabase.
-- Existen 4 funciones en public que usan tipos/funciones de PostGIS
-- (ST_SetSRID, ST_MakePoint, ST_DWithin, geography):
--   - sync_profile_location  (trigger en profiles)
--   - sync_ride_location     (trigger en rides)
--   - get_nearby_drivers
--   - get_nearby_rides       (versión PostGIS, distinta a la Haversine)
--
-- Cuando register_membership_payment (search_path=public) actualiza
-- profiles, dispara sync_profile_location, que hereda el search_path
-- restringido y no encuentra geography → ERROR.
--
-- Fix: ALTER FUNCTION para agregar "extensions" al search_path de
-- las funciones que usan PostGIS, sin tocar su lógica.
-- También arreglamos las funciones de la cadena de pago para que no
-- propaguen un search_path restringido a triggers heredados.
-- ============================================================

-- ── 1. Funciones PostGIS existentes (las que detectó la query diag) ──
ALTER FUNCTION public.sync_profile_location()  SET search_path = public, extensions;
ALTER FUNCTION public.sync_ride_location()     SET search_path = public, extensions;

-- get_nearby_drivers y get_nearby_rides: pueden tener distintas firmas;
-- usamos DO block para alterarlas dinámicamente sin asumir parámetros.
DO $$
DECLARE
    fn_sig TEXT;
BEGIN
    FOR fn_sig IN
        SELECT pg_catalog.pg_get_function_identity_arguments(p.oid) AS args_str
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('get_nearby_drivers', 'get_nearby_rides')
    LOOP
        -- nada — el loop sirve para iterar; armamos los ALTERs aparte.
        NULL;
    END LOOP;

    -- Aplicar ALTER FUNCTION a cada firma encontrada.
    FOR fn_sig IN
        SELECT 'ALTER FUNCTION public.' || p.proname
               || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
               || ' SET search_path = public, extensions;'
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('get_nearby_drivers', 'get_nearby_rides')
    LOOP
        EXECUTE fn_sig;
    END LOOP;
END $$;

-- ── 2. Cadena de pago: ampliar search_path para que triggers heredados
--       (sync_profile_location en particular) encuentren PostGIS ───────

ALTER FUNCTION public.driver_has_active_membership(UUID)
    SET search_path = public, extensions;

ALTER FUNCTION public.sync_driver_subscription_status()
    SET search_path = public, extensions;

ALTER FUNCTION public.register_membership_payment(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TEXT, JSONB
)   SET search_path = public, extensions;

-- ── 3. Funciones de cobertura (migración 20) — por consistencia ──────
ALTER FUNCTION public.is_within_coverage(float8, float8)
    SET search_path = public, extensions;

-- ── 4. Verificación ──
-- Devuelve la lista de funciones afectadas con su search_path actual.
SELECT
    p.proname,
    pg_get_function_identity_arguments(p.oid) AS args,
    array_to_string(p.proconfig, ', ') AS config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'sync_profile_location', 'sync_ride_location',
      'get_nearby_drivers', 'get_nearby_rides',
      'driver_has_active_membership', 'sync_driver_subscription_status',
      'register_membership_payment', 'is_within_coverage'
  )
ORDER BY p.proname;
