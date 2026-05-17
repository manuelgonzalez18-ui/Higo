-- ============================================================
-- 30 · Métricas del canal de soporte
-- ============================================================
-- Fase 5 (paso 4/4). Devuelve un JSONB con todos los KPIs en una
-- sola llamada — más barato que N round-trips para un panel.
-- Métricas: tiempo de primera respuesta (avg/median), tiempo de
-- resolución (open→closed), volumen diario, top admins, contadores.

CREATE OR REPLACE FUNCTION public.support_stats(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    result JSONB;
    cutoff TIMESTAMPTZ;
    n_days INT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    n_days := LEAST(GREATEST(coalesce(p_days, 30), 1), 365);
    cutoff := timezone('utc', now()) - (n_days || ' days')::INTERVAL;

    WITH
    first_msgs AS (
        SELECT thread_id,
               MIN(CASE WHEN sender_role = 'user'  THEN created_at END) AS first_user,
               MIN(CASE WHEN sender_role = 'admin' THEN created_at END) AS first_admin
          FROM public.support_messages
         WHERE created_at >= cutoff
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
           AND last_message_at >= cutoff
    ),
    volume AS (
        SELECT date_trunc('day', m.created_at) AS day,
               COUNT(*)                                       AS msgs_total,
               COUNT(*) FILTER (WHERE m.sender_role = 'user')  AS msgs_user,
               COUNT(*) FILTER (WHERE m.sender_role = 'admin') AS msgs_admin
          FROM public.support_messages m
         WHERE m.created_at >= cutoff
           AND m.deleted_at IS NULL
         GROUP BY day
    ),
    threads_per_day AS (
        SELECT date_trunc('day', created_at) AS day,
               COUNT(*) AS threads_opened
          FROM public.support_threads
         WHERE created_at >= cutoff
         GROUP BY day
    ),
    top_admins AS (
        SELECT m.sender_id,
               p.full_name,
               COUNT(*)                          AS msgs_sent,
               COUNT(DISTINCT m.thread_id)       AS threads_replied
          FROM public.support_messages m
          JOIN public.profiles p ON p.id = m.sender_id
         WHERE m.created_at >= cutoff
           AND m.sender_role = 'admin'
           AND m.deleted_at IS NULL
         GROUP BY m.sender_id, p.full_name
         ORDER BY msgs_sent DESC
         LIMIT 5
    )
    SELECT jsonb_build_object(
        'days', n_days,
        'first_response_avg_minutes',
            (SELECT round(avg(minutes)::numeric, 1) FROM response_times),
        'first_response_median_minutes',
            (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes))::numeric, 1) FROM response_times),
        'resolution_avg_hours',
            (SELECT round(avg(hours)::numeric, 1) FROM resolution_times),
        'closed_count',
            (SELECT count(*) FROM resolution_times),
        'open_count',
            (SELECT count(*) FROM public.support_threads WHERE status = 'open'),
        'open_unanswered',
            (SELECT count(*) FROM public.support_threads WHERE status = 'open' AND unread_for_admin = true),
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

GRANT EXECUTE ON FUNCTION public.support_stats(INT) TO authenticated;
