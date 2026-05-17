-- ============================================================
-- 32 · Comparativa contra período previo en support_stats
-- ============================================================
-- Fase 6 (paso 3/4). El RPC de la migración 30 devolvía solo el rango
-- actual. Ahora también calcula la ventana inmediatamente anterior
-- (mismo largo) para que las KPI cards puedan mostrar deltas
-- "+15% vs período previo". Refactor: extraemos la lógica común a
-- una función helper que recibe [p_start, p_end) y se llama dos veces.

-- ─── Helper interno ─────────────────────────────────────────────────
-- Calcula todas las métricas de ventana sobre un intervalo.
-- Marca SECURITY DEFINER + REVOKE EXECUTE FROM PUBLIC para que NO
-- pueda invocarse directo desde PostgREST (eso saltearía el chequeo
-- de admin que vive en support_stats).

CREATE OR REPLACE FUNCTION public._support_stats_window(
    p_start TIMESTAMPTZ,
    p_end   TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    result JSONB;
BEGIN
    WITH
    first_msgs AS (
        SELECT thread_id,
               MIN(CASE WHEN sender_role = 'user'  THEN created_at END) AS first_user,
               MIN(CASE WHEN sender_role = 'admin' THEN created_at END) AS first_admin
          FROM public.support_messages
         WHERE created_at >= p_start AND created_at < p_end
           AND deleted_at IS NULL
         GROUP BY thread_id
    ),
    response_times AS (
        SELECT EXTRACT(EPOCH FROM (first_admin - first_user)) / 60.0 AS minutes
          FROM first_msgs
         WHERE first_user IS NOT NULL
           AND first_admin IS NOT NULL
           AND first_admin > first_user
    ),
    resolution_times AS (
        SELECT EXTRACT(EPOCH FROM (last_message_at - created_at)) / 3600.0 AS hours
          FROM public.support_threads
         WHERE status = 'closed'
           AND last_message_at >= p_start
           AND last_message_at < p_end
    ),
    volume AS (
        SELECT date_trunc('day', m.created_at) AS day,
               COUNT(*)                                       AS msgs_total,
               COUNT(*) FILTER (WHERE m.sender_role = 'user')  AS msgs_user,
               COUNT(*) FILTER (WHERE m.sender_role = 'admin') AS msgs_admin
          FROM public.support_messages m
         WHERE m.created_at >= p_start AND m.created_at < p_end
           AND m.deleted_at IS NULL
         GROUP BY day
    ),
    threads_per_day AS (
        SELECT date_trunc('day', created_at) AS day,
               COUNT(*) AS threads_opened
          FROM public.support_threads
         WHERE created_at >= p_start AND created_at < p_end
         GROUP BY day
    ),
    top_admins AS (
        SELECT m.sender_id,
               p.full_name,
               COUNT(*)                          AS msgs_sent,
               COUNT(DISTINCT m.thread_id)       AS threads_replied
          FROM public.support_messages m
          JOIN public.profiles p ON p.id = m.sender_id
         WHERE m.created_at >= p_start AND m.created_at < p_end
           AND m.sender_role = 'admin'
           AND m.deleted_at IS NULL
         GROUP BY m.sender_id, p.full_name
         ORDER BY msgs_sent DESC
         LIMIT 5
    )
    SELECT jsonb_build_object(
        'first_response_avg_minutes',
            (SELECT round(avg(minutes)::numeric, 1) FROM response_times),
        'first_response_median_minutes',
            (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes))::numeric, 1) FROM response_times),
        'resolution_avg_hours',
            (SELECT round(avg(hours)::numeric, 1) FROM resolution_times),
        'closed_count',
            (SELECT count(*) FROM resolution_times),
        'msgs_total',
            (SELECT coalesce(sum(msgs_total), 0) FROM volume),
        'threads_opened',
            (SELECT coalesce(sum(threads_opened), 0) FROM threads_per_day),
        'volume_by_day',
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'day',            to_char(v.day, 'YYYY-MM-DD'),
                'msgs_total',     v.msgs_total,
                'msgs_user',      v.msgs_user,
                'msgs_admin',     v.msgs_admin,
                'threads_opened', coalesce(tpd.threads_opened, 0)
              ) ORDER BY v.day)
              FROM volume v
              LEFT JOIN threads_per_day tpd ON tpd.day = v.day),
              '[]'::jsonb),
        'top_admins',
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'admin_id',        sender_id,
                'full_name',       full_name,
                'msgs_sent',       msgs_sent,
                'threads_replied', threads_replied
              )) FROM top_admins),
              '[]'::jsonb)
    ) INTO result;
    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public._support_stats_window(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;

-- ─── RPC público ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_stats(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    n_days     INT;
    now_ts     TIMESTAMPTZ;
    cur_start  TIMESTAMPTZ;
    prev_start TIMESTAMPTZ;
    cur        JSONB;
    prev       JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    n_days     := LEAST(GREATEST(coalesce(p_days, 30), 1), 365);
    now_ts     := timezone('utc', now());
    cur_start  := now_ts - (n_days       || ' days')::INTERVAL;
    prev_start := now_ts - ((n_days * 2) || ' days')::INTERVAL;

    cur  := public._support_stats_window(cur_start,  now_ts);
    prev := public._support_stats_window(prev_start, cur_start);

    RETURN jsonb_build_object(
        'days', n_days,
        -- estado actual del backlog (no depende de ventana)
        'open_count',
            (SELECT count(*) FROM public.support_threads WHERE status = 'open'),
        'open_unanswered',
            (SELECT count(*) FROM public.support_threads WHERE status = 'open' AND unread_for_admin = true),
        -- métricas del rango (compat con shape anterior)
        'first_response_avg_minutes',    cur->'first_response_avg_minutes',
        'first_response_median_minutes', cur->'first_response_median_minutes',
        'resolution_avg_hours',          cur->'resolution_avg_hours',
        'closed_count',                  cur->'closed_count',
        'volume_by_day',                 cur->'volume_by_day',
        'top_admins',                    cur->'top_admins',
        -- nuevo: snapshot del período inmediato anterior
        'previous',                      prev
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.support_stats(INT) TO authenticated;
