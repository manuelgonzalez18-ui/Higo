-- ============================================================
-- 65 · Solución de Recursión Infinita en RLS de Rides
-- ============================================================
--
-- Explicación del problema:
-- La policy de SELECT en `rides` ("Drivers can view all requested rides")
-- hacía un SELECT en `profiles`. A su vez, una policy de SELECT en `profiles`
-- ("profiles_ride_party_read") hacía un SELECT en `rides`. Esto provocaba
-- una recursión infinita en PostgreSQL cuando un pasajero intentaba insertar
-- y seleccionar su propio ride, haciendo que la base de datos se colgara
-- y la interfaz cliente se quedara congelada en "Confirmando...".
--
-- Solución:
-- Definir una función `is_driver` con SECURITY DEFINER. Al ser SECURITY DEFINER,
-- se ejecuta con los privilegios del creador (bypass RLS) y no evalúa las
-- policies de `profiles` al consultar el rol, rompiendo la recursión por completo.

BEGIN;

-- 1. Crear función SECURITY DEFINER para verificar si un usuario es conductor
CREATE OR REPLACE FUNCTION public.is_driver(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_uid AND role = 'driver'
    );
$$;

REVOKE ALL ON FUNCTION public.is_driver(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_driver(UUID) TO authenticated;

-- 2. Actualizar policy de SELECT: "Drivers can view all requested rides"
DROP POLICY IF EXISTS "Drivers can view all requested rides" ON public.rides;
CREATE POLICY "Drivers can view all requested rides"
ON public.rides FOR SELECT TO authenticated
USING (
  public.is_driver(auth.uid())
  AND status = 'requested'
);

-- 3. Actualizar policy de UPDATE: "Drivers can update rides to accept"
DROP POLICY IF EXISTS "Drivers can update rides to accept" ON public.rides;
CREATE POLICY "Drivers can update rides to accept"
ON public.rides FOR UPDATE TO authenticated
USING (
  public.is_driver(auth.uid())
);

COMMIT;
