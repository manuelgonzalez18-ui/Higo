-- ============================================================
-- 59 · delivery_analytics RPC — KPIs de envíos
-- ============================================================
-- Anexo Higo Envíos v2, Fase E6.2.
--
-- Function única consolidada. Devuelve JSONB con todos los KPIs:
--   total, success_rate, avg_pickup_to_delivery_min, claims_rate,
--   top_destinations, distribution_by_weight, distribution_by_vehicle.

BEGIN;

CREATE OR REPLACE FUNCTION public.delivery_analytics(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  WITH base AS (
    SELECT r.* FROM public.rides r
     WHERE r.service_type = 'delivery'
       AND r.created_at >= p_from
       AND r.created_at <  p_to
  ),
  totals AS (
    SELECT
      COUNT(*)                                         AS total,
      COUNT(*) FILTER (WHERE status = 'completed')     AS completed,
      COUNT(*) FILTER (WHERE status = 'cancelled')     AS cancelled,
      AVG(EXTRACT(EPOCH FROM (delivered_at - picked_up_at))/60)
        FILTER (WHERE picked_up_at IS NOT NULL AND delivered_at IS NOT NULL)
        AS avg_pickup_to_delivery_min
    FROM base
  ),
  claims AS (
    SELECT COUNT(*) AS total_claims
      FROM public.delivery_claims c
      JOIN base b ON b.id = c.ride_id
  ),
  by_vehicle AS (
    SELECT jsonb_object_agg(ride_type, c) AS data
    FROM (SELECT ride_type, COUNT(*) c FROM base GROUP BY ride_type) v
  ),
  by_weight AS (
    SELECT jsonb_object_agg(bucket, c) AS data
    FROM (
      SELECT COALESCE(delivery_info->>'package_weight_kg','unknown') bucket,
             COUNT(*) c
        FROM base
       GROUP BY 1
    ) w
  ),
  top_dest AS (
    SELECT jsonb_agg(jsonb_build_object('dropoff', dropoff, 'count', c)
                     ORDER BY c DESC) AS data
      FROM (
        SELECT dropoff, COUNT(*) c FROM base
         GROUP BY dropoff
         ORDER BY c DESC
         LIMIT 10
      ) t
  )
  SELECT jsonb_build_object(
    'total',              totals.total,
    'completed',          totals.completed,
    'cancelled',          totals.cancelled,
    'success_rate',       CASE WHEN totals.total > 0
                               THEN ROUND(totals.completed::numeric / totals.total, 4)
                               ELSE 0 END,
    'avg_pickup_to_delivery_min',
                          ROUND(COALESCE(totals.avg_pickup_to_delivery_min, 0)::numeric, 1),
    'claims_total',       claims.total_claims,
    'claims_rate',        CASE WHEN totals.total > 0
                               THEN ROUND(claims.total_claims::numeric / totals.total, 4)
                               ELSE 0 END,
    'by_vehicle',         COALESCE(by_vehicle.data, '{}'::jsonb),
    'by_weight',          COALESCE(by_weight.data, '{}'::jsonb),
    'top_destinations',   COALESCE(top_dest.data, '[]'::jsonb)
  )
    INTO v_result
    FROM totals, claims, by_vehicle, by_weight, top_dest;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delivery_analytics(TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;

COMMIT;
