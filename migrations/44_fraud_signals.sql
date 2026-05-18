-- ============================================================
-- 44 · fraud_signals — vista materializada de señales de fraude
-- ============================================================
-- Fase 11 paso D.A3 del roadmap.
--
-- Heurísticas básicas para detectar usuarios/viajes sospechosos.
-- Vista materializada para que el panel admin no recompute en cada
-- visit. REFRESH manual desde el panel via RPC refresh_fraud_signals,
-- o vía cron (recomendado cada 1h en Hostinger cPanel).
--
-- Señales implementadas (todas básicas — el modelo ML serio queda
-- para Fase 16):
--   1. Pasajeros con N+ rides cancelados sin haber completado nunca.
--   2. Drivers con rating promedio < 3 con >= 5 viajes.
--   3. Rides con velocidad promedio "imposible" (> 150 km/h).
-- Cada fila: (subject_type, subject_id TEXT, signal, severity, metadata jsonb).
-- subject_id es TEXT para uniformar UUIDs (passenger/driver) y BIGINT
-- (rides.id::TEXT).

DROP MATERIALIZED VIEW IF EXISTS public.fraud_signals;

CREATE MATERIALIZED VIEW public.fraud_signals AS
-- ─── Señal 1: pasajeros con muchas cancelaciones ──────────────────
SELECT
    'passenger'::TEXT                         AS subject_type,
    r.user_id::TEXT                           AS subject_id,
    'multiple_cancellations'::TEXT            AS signal,
    CASE
        WHEN COUNT(*) FILTER (WHERE r.status = 'cancelled') >= 10 THEN 'high'
        WHEN COUNT(*) FILTER (WHERE r.status = 'cancelled') >= 5  THEN 'medium'
        ELSE                                                          'low'
    END                                       AS severity,
    jsonb_build_object(
        'cancelled_count', COUNT(*) FILTER (WHERE r.status = 'cancelled'),
        'completed_count', COUNT(*) FILTER (WHERE r.status = 'completed'),
        'window_days',     30
    )                                         AS metadata,
    NOW()                                     AS computed_at
FROM public.rides r
WHERE r.created_at >= NOW() - INTERVAL '30 days'
GROUP BY r.user_id
HAVING COUNT(*) FILTER (WHERE r.status = 'cancelled') >= 3
   AND COUNT(*) FILTER (WHERE r.status = 'completed') = 0

UNION ALL

-- ─── Señal 2: drivers con rating bajo sostenido ───────────────────
SELECT
    'driver'::TEXT,
    r.driver_id::TEXT,
    'low_rating'::TEXT,
    CASE
        WHEN AVG(r.rating) < 2   THEN 'high'
        WHEN AVG(r.rating) < 2.5 THEN 'medium'
        ELSE                          'low'
    END,
    jsonb_build_object(
        'avg_rating',  ROUND(AVG(r.rating)::numeric, 2),
        'rated_rides', COUNT(*)
    ),
    NOW()
FROM public.rides r
WHERE r.driver_id IS NOT NULL
  AND r.rating IS NOT NULL
  AND r.created_at >= NOW() - INTERVAL '60 days'
GROUP BY r.driver_id
HAVING AVG(r.rating) < 3 AND COUNT(*) >= 5

UNION ALL

-- ─── Señal 3: rides con velocidad imposible (>150 km/h) ───────────
-- Haversine para distancia (sin PostGIS). duration = payment_confirmed_at
-- - created_at, en horas. Si duration < 1 min se descarta (probable
-- bug, no fraude). Solo rides 'completed' con coords + payment_at.
SELECT
    'ride'::TEXT,
    r.id::TEXT,
    'impossible_speed'::TEXT,
    'high'::TEXT,
    jsonb_build_object(
        'speed_kmh',      ROUND(calc.speed_kmh::numeric, 1),
        'distance_km',    ROUND(calc.distance_km::numeric, 2),
        'duration_hours', ROUND(calc.duration_hours::numeric, 3),
        'pickup',         r.pickup,
        'dropoff',        r.dropoff
    ),
    NOW()
FROM public.rides r
JOIN LATERAL (
    SELECT
        (6371 * 2 * asin(sqrt(
            sin(radians((r.dropoff_lat - r.pickup_lat) / 2)) ^ 2
            + cos(radians(r.pickup_lat)) * cos(radians(r.dropoff_lat))
            * sin(radians((r.dropoff_lng - r.pickup_lng) / 2)) ^ 2
        ))) AS distance_km,
        EXTRACT(EPOCH FROM (r.payment_confirmed_at - r.created_at)) / 3600.0 AS duration_hours
) base ON true
JOIN LATERAL (
    SELECT
        base.distance_km,
        base.duration_hours,
        CASE WHEN base.duration_hours > 0.0167  -- >= 1 min
             THEN base.distance_km / base.duration_hours
             ELSE NULL
        END AS speed_kmh
) calc ON true
WHERE r.status = 'completed'
  AND r.pickup_lat  IS NOT NULL AND r.pickup_lng  IS NOT NULL
  AND r.dropoff_lat IS NOT NULL AND r.dropoff_lng IS NOT NULL
  AND r.payment_confirmed_at IS NOT NULL
  AND r.created_at >= NOW() - INTERVAL '60 days'
  AND calc.speed_kmh IS NOT NULL
  AND calc.speed_kmh > 150;

CREATE INDEX IF NOT EXISTS idx_fraud_signals_subject
    ON public.fraud_signals (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_severity
    ON public.fraud_signals (severity, computed_at DESC);

-- ─── RPC: refresh manual desde el panel admin ─────────────────────
CREATE OR REPLACE FUNCTION public.refresh_fraud_signals()
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    REFRESH MATERIALIZED VIEW public.fraud_signals;
    RETURN NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_fraud_signals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_fraud_signals() TO authenticated;

-- ─── RPC: get_fraud_signals con filtro admin ──────────────────────
-- Las MVs no soportan RLS nativo. Wrappereamos via SECURITY DEFINER
-- que valida is_admin antes de SELECT. El GRANT SELECT directo de
-- la MV queda revoked para todos los users no-admin.
CREATE OR REPLACE FUNCTION public.get_fraud_signals()
RETURNS SETOF public.fraud_signals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT *
          FROM public.fraud_signals
         ORDER BY
            CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            computed_at DESC;
END;
$$;

REVOKE ALL ON public.fraud_signals FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_fraud_signals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fraud_signals() TO authenticated;
