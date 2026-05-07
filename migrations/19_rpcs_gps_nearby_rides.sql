-- Migración 19: Documentar RPCs de GPS y viajes cercanos
--
-- Estas dos funciones existen en Supabase pero nunca se registraron
-- en el repo. Este archivo permite reproducir el schema desde cero.
--
-- Aplicar en: Supabase SQL Editor (idempotente — usa CREATE OR REPLACE).

-- ─────────────────────────────────────────────────────────────────
-- 1. Columna heading en profiles
--    El dashboard del conductor la lee en línea:
--    `if (profile.heading) setHeading(profile.heading);`
--    y la escribe vía update_driver_gps.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS heading float DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────
-- 2. update_driver_gps — actualiza posición del conductor activo
--
-- Llamado desde DriverDashboard.jsx cada vez que hay movimiento
-- significativo (≥20 m o ≥10 s desde última sync).
-- Usa auth.uid() para que ningún conductor pueda mover a otro.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_driver_gps(
    lat  float8,
    lng  float8,
    head float8 DEFAULT 0
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.profiles
    SET
        curr_lat             = lat,
        curr_lng             = lng,
        heading              = head,
        last_location_update = now()
    WHERE id = auth.uid();
$$;

-- Solo el propio conductor puede llamarla (ejecuta como DEFINER
-- pero el WHERE id = auth.uid() lo limita a su propio perfil).
GRANT EXECUTE ON FUNCTION public.update_driver_gps(float8, float8, float8) TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. get_nearby_rides — viajes cercanos que coinciden con el vehículo
--
-- Llamado cada 30 s desde el watcher de GPS del conductor.
-- Parámetros:
--   driver_lat/lng       posición actual del conductor
--   radius_km            radio de búsqueda (app usa 30 km)
--   driver_vehicle_type  'moto' | 'standard' | 'van'
--
-- Lógica de matching vehicle:
--   moto     → ride_type = 'moto'
--   standard → ride_type IN ('standard', 'car')
--   van      → ride_type = 'van'
--
-- Solo devuelve viajes con status='requested' y creados en los
-- últimos 10 minutos para evitar mostrar solicitudes viejas.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nearby_rides(
    driver_lat          float8,
    driver_lng          float8,
    radius_km           float8 DEFAULT 30.0,
    driver_vehicle_type text   DEFAULT 'standard'
)
RETURNS SETOF public.rides
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT r.*
    FROM public.rides r
    WHERE
        r.status     = 'requested'
        AND r.driver_id IS NULL
        AND r.created_at >= now() - interval '10 minutes'
        -- Filtro de tipo de vehículo
        AND (
            (driver_vehicle_type = 'moto'     AND lower(r.ride_type) = 'moto')
            OR
            (driver_vehicle_type = 'van'      AND lower(r.ride_type) = 'van')
            OR
            (driver_vehicle_type = 'standard' AND lower(r.ride_type) IN ('standard', 'car'))
        )
        -- Filtro de distancia con Haversine (en km)
        -- Solo aplica si el viaje tiene coordenadas de pickup;
        -- los viajes sin coordenadas se devuelven siempre (legacy).
        AND (
            r.pickup_lat IS NULL
            OR (
                2 * 6371 * asin(sqrt(
                    power(sin(radians((r.pickup_lat - driver_lat) / 2)), 2)
                    + cos(radians(driver_lat))
                    * cos(radians(r.pickup_lat))
                    * power(sin(radians((r.pickup_lng - driver_lng) / 2)), 2)
                )) <= radius_km
            )
        )
    ORDER BY r.created_at DESC
    LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.get_nearby_rides(float8, float8, float8, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4. Índice para acelerar get_nearby_rides
--    El filtro más selectivo es status + created_at; el índice
--    ya existe en rides pero lo documentamos aquí por completitud.
-- ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rides_status_created
    ON public.rides (status, created_at DESC)
    WHERE status = 'requested';
