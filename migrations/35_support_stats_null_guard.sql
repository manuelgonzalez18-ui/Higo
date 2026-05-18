-- ============================================================
-- 35 · Guard explícito de auth.uid() en RPCs de soporte
-- ============================================================
-- Fase 7 paso B5 del roadmap. Las funciones support_stats() y
-- search_support_messages() ya tenían admin check, pero la condición
-- usaba `NOT EXISTS (... WHERE id = auth.uid() AND role = 'admin')`,
-- que devuelve true tanto si:
--   (a) auth.uid() es NULL (sesión vencida / sin token)
--   (b) auth.uid() es un user real pero NO admin
-- Ambos casos terminaban con RAISE EXCEPTION 'forbidden', sin que el
-- frontend pudiera distinguir "te tenés que loguear de nuevo" de
-- "no tenés permiso".
--
-- Este parche separa los dos casos con un IF explícito antes del
-- chequeo de role. Más explícito + más fácil de debuggear en el log.

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
    -- ▼ Guard nuevo: sesión vencida o request sin token.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
    END IF;
    -- ▼ Guard preexistente: usuario logueado pero no admin.
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    n_days     := LEAST(GREATEST(coalesce(p_days, 30), 1), 365);
    now_ts     := timezone('utc', now());
    cur_start  := now_ts - (n_days       || ' days')::INTERVAL;
    prev_start := now_ts - ((n_days * 2) || ' days')::INTERVAL;

    cur  := public._support_stats_window(cur_start,  now_ts);
    prev := public._support_stats_window(prev_start, cur_start);

    RETURN jsonb_build_object(
        'days', n_days,
        'open_count',
            (SELECT count(*) FROM public.support_threads WHERE status = 'open'),
        'open_unanswered',
            (SELECT count(*) FROM public.support_threads WHERE status = 'open' AND unread_for_admin = true),
        'first_response_avg_minutes',    cur->'first_response_avg_minutes',
        'first_response_median_minutes', cur->'first_response_median_minutes',
        'resolution_avg_hours',          cur->'resolution_avg_hours',
        'closed_count',                  cur->'closed_count',
        'volume_by_day',                 cur->'volume_by_day',
        'top_admins',                    cur->'top_admins',
        'previous',                      prev
    );
END;
$$;

-- Mismo guard explícito en search_support_messages.
CREATE OR REPLACE FUNCTION public.search_support_messages(
    p_query TEXT,
    p_limit INT DEFAULT 50
)
RETURNS TABLE (
    message_id           BIGINT,
    thread_id            BIGINT,
    content              TEXT,
    sender_role          TEXT,
    created_at           TIMESTAMPTZ,
    thread_status        TEXT,
    thread_role_context  TEXT,
    user_id              UUID,
    user_full_name       TEXT,
    user_role            TEXT,
    user_avatar          TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    q TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    q := trim(coalesce(p_query, ''));
    IF length(q) < 2 THEN RETURN; END IF;

    RETURN QUERY
    SELECT m.id, m.thread_id, m.content, m.sender_role, m.created_at,
           t.status, t.role_context, t.user_id, p.full_name, p.role, p.avatar_url
      FROM public.support_messages m
      JOIN public.support_threads t ON t.id = m.thread_id
      LEFT JOIN public.profiles p ON p.id = t.user_id
     WHERE m.deleted_at IS NULL
       AND m.content IS NOT NULL
       AND m.content ILIKE '%' || q || '%'
     ORDER BY m.created_at DESC
     LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$$;
