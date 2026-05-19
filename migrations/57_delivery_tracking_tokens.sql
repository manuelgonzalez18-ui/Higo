-- ============================================================
-- 57 · delivery_tracking_tokens — links públicos de tracking
-- ============================================================
-- Anexo Higo Envíos v2, Fase E4.3.
--
-- Token UUID que el remitente comparte con el destinatario. La página
-- pública /track/:token (sin auth) muestra estado, ubicación del chofer
-- si está en in_progress, hitos pasados, foto POD si entregado.
-- TTL: 7 días post-creación o 24h post-delivery (lo que ocurra primero).

BEGIN;

CREATE TABLE IF NOT EXISTS public.delivery_tracking_tokens (
  token       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS delivery_tracking_tokens_ride_idx
  ON public.delivery_tracking_tokens (ride_id);

ALTER TABLE public.delivery_tracking_tokens ENABLE ROW LEVEL SECURITY;

-- Crear: remitente o admin
DROP POLICY IF EXISTS delivery_tracking_tokens_insert ON public.delivery_tracking_tokens;
CREATE POLICY delivery_tracking_tokens_insert
ON public.delivery_tracking_tokens FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = ride_id AND r.user_id = auth.uid()
  )
  OR public.is_admin(auth.uid())
);

-- Leer: cualquiera con auth puede leer (filtro del token va en la query
-- pública). La función pública get_public_tracking() expone lo mínimo
-- y verifica TTL y validez del token sin requerir auth.
DROP POLICY IF EXISTS delivery_tracking_tokens_select ON public.delivery_tracking_tokens;
CREATE POLICY delivery_tracking_tokens_select
ON public.delivery_tracking_tokens FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id = ride_id
       AND (r.user_id = auth.uid() OR r.driver_id = auth.uid())
  )
  OR public.is_admin(auth.uid())
);

-- Función pública (sin auth) para la página /track/:token
CREATE OR REPLACE FUNCTION public.get_public_tracking(p_token UUID)
RETURNS TABLE (
  status TEXT,
  service_type TEXT,
  pickup TEXT,
  dropoff TEXT,
  picked_up_at TIMESTAMPTZ,
  arrived_at_dropoff_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  driver_display_name TEXT,
  driver_lat NUMERIC,
  driver_lng NUMERIC,
  delivery_pod_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.status,
    r.service_type,
    r.pickup,
    r.dropoff,
    r.picked_up_at,
    r.arrived_at_dropoff_at,
    r.delivered_at,
    p.display_name,
    CASE WHEN r.status IN ('accepted','in_progress','arrived_at_dropoff')
         THEN p.current_lat ELSE NULL END,
    CASE WHEN r.status IN ('accepted','in_progress','arrived_at_dropoff')
         THEN p.current_lng ELSE NULL END,
    r.delivery_pod_url
  FROM public.delivery_tracking_tokens t
  JOIN public.rides r ON r.id = t.ride_id
  LEFT JOIN public.profiles p ON p.id = r.driver_id
  WHERE t.token = p_token
    AND t.expires_at > NOW()
    AND r.service_type = 'delivery'
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_tracking(UUID) TO anon, authenticated;

COMMIT;
