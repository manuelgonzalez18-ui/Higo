-- ============================================================
-- 33 · Hilos de soporte separados por contexto de rol
-- ============================================================
-- Bug reportado: si un mismo auth.uid() usaba el widget desde la
-- vista de pasajero (/ride/:id) y desde la vista de conductor
-- (/driver), todos los mensajes terminaban en UN solo hilo porque
-- support_threads.user_id era UNIQUE. Resultado: el conductor veía
-- los mensajes que él mismo había escrito como pasajero, y el admin
-- los recibía catalogados con un solo role (el de profile.role).
--
-- Fix: el unique pasa a ser (user_id, role_context). El widget
-- detecta el contexto desde la URL (pasajero por defecto, driver si
-- estamos en /driver*). Un mismo user puede tener hasta 2 hilos:
-- "Pulio como pasajero" y "Pulio como conductor".

-- ─── Nueva columna ──────────────────────────────────────────────────
ALTER TABLE public.support_threads
    ADD COLUMN IF NOT EXISTS role_context TEXT NOT NULL DEFAULT 'passenger';

-- CHECK separado (idempotente).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'support_threads_role_context_chk'
    ) THEN
        ALTER TABLE public.support_threads
            ADD CONSTRAINT support_threads_role_context_chk
            CHECK (role_context IN ('passenger', 'driver'));
    END IF;
END $$;

-- Backfill: hilos preexistentes se etiquetan según profile.role.
-- Si el user era driver al crear el hilo, marca 'driver'; si no,
-- queda como 'passenger' (el default).
UPDATE public.support_threads t
   SET role_context = 'driver'
  FROM public.profiles p
 WHERE p.id = t.user_id
   AND p.role = 'driver'
   AND t.role_context = 'passenger';

-- ─── Sacar el UNIQUE viejo (solo user_id) y crear el nuevo ──────────
-- El nombre que Postgres le pone al UNIQUE inline es
-- support_threads_user_id_key. Si por alguna razón no existe (alguna
-- versión vieja), no rompemos.
ALTER TABLE public.support_threads
    DROP CONSTRAINT IF EXISTS support_threads_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS support_threads_user_role_uq
    ON public.support_threads (user_id, role_context);

-- ─── search_support_messages: exponer role_context ──────────────────
-- Rebuild de la firma para incluir thread_role_context. El admin ya
-- no usa profile.role para el chip; usa el contexto del hilo.

DROP FUNCTION IF EXISTS public.search_support_messages(TEXT, INT);

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
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
        RAISE EXCEPTION 'forbidden';
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

GRANT EXECUTE ON FUNCTION public.search_support_messages(TEXT, INT) TO authenticated;
