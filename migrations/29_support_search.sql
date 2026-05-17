-- ============================================================
-- 29 · Búsqueda full-text dentro de mensajes de soporte
-- ============================================================
-- Fase 5 (paso 3/4). El admin necesita buscar dentro de todas las
-- conversaciones — "¿alguien reportó X?", "encontrame el hilo donde
-- mencionaron tal placa". Hacemos un índice trigram (pg_trgm) que da
-- ILIKE rápido sin tener que configurar diccionarios de español.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_support_messages_content_trgm
    ON public.support_messages USING gin (content gin_trgm_ops);

-- ─── RPC: búsqueda por substring, solo admins ───────────────────────
-- Devuelve hits ya joinados con thread + perfil del usuario para que
-- el frontend pinte la lista en una sola llamada.
CREATE OR REPLACE FUNCTION public.search_support_messages(
    p_query TEXT,
    p_limit INT DEFAULT 50
)
RETURNS TABLE (
    message_id     BIGINT,
    thread_id      BIGINT,
    content        TEXT,
    sender_role    TEXT,
    created_at     TIMESTAMPTZ,
    thread_status  TEXT,
    user_id        UUID,
    user_full_name TEXT,
    user_role      TEXT,
    user_avatar    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    q TEXT;
BEGIN
    -- Solo admins.
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    q := trim(coalesce(p_query, ''));
    IF length(q) < 2 THEN
        RETURN; -- evita escanear toda la tabla con búsqueda vacía.
    END IF;

    RETURN QUERY
    SELECT m.id, m.thread_id, m.content, m.sender_role, m.created_at,
           t.status, t.user_id, p.full_name, p.role, p.avatar_url
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

GRANT EXECUTE ON FUNCTION public.search_support_messages(TEXT, INT) TO authenticated;
