-- Índices para acelerar las queries más frecuentes.
-- Ejecutar en Supabase SQL editor.

-- rides: filtros por status (drivers), driver_id (historial del conductor),
-- user_id (historial del pasajero), created_at (orden temporal).
CREATE INDEX IF NOT EXISTS idx_rides_status ON public.rides(status);
CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON public.rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_user_id ON public.rides(user_id);
CREATE INDEX IF NOT EXISTS idx_rides_created_at ON public.rides(created_at DESC);

-- Índice compuesto para el smart assignment (get_nearby_rides):
-- busca rides pendientes cercanos a la posición del conductor.
CREATE INDEX IF NOT EXISTS idx_rides_requested_coords
    ON public.rides(status, pickup_lat, pickup_lng)
    WHERE status = 'requested';

-- profiles: rol (admin queries), ubicación (smart assignment),
-- estado online (match con drivers disponibles).
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_curr_location
    ON public.profiles(curr_lat, curr_lng)
    WHERE status = 'online';

-- messages: por ride (scroll del chat) y creación.
CREATE INDEX IF NOT EXISTS idx_messages_ride_id ON public.messages(ride_id, created_at);
