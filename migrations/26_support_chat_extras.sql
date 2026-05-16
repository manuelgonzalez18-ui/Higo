-- ============================================================
-- 26 · Extras del chat de soporte: adjuntos + read receipts
-- ============================================================
-- Fase 4 del soporte. Suma a la base de la migración 25:
--   · attachment_path / mime / size   → adjuntos (imágenes) por mensaje
--   · read_at                          → marcas de "visto" por mensaje
--   · bucket `support-attachments`     → privado, signed URLs on-demand
--   · RPC mark_support_thread_read     → marca como leído en un round-trip
--
-- Decisiones:
--   · Bucket privado (NO público como avatars). Capturas de soporte pueden
--     llevar info sensible (saldos, comprobantes, mensajes de error). El
--     frontend genera signed URLs cortas (1h) y el PHP usa service role
--     para incrustar miniatura en el email.
--   · Path: <thread_id>/<sender_uuid>/<timestamp>-<rand>.<ext>
--     → primer folder = thread → fácil filtrar permisos.
--     → segundo folder = sender → bloquea impersonation en INSERT.

-- ─── Columnas nuevas en support_messages ────────────────────────────
ALTER TABLE public.support_messages
    ADD COLUMN IF NOT EXISTS attachment_path TEXT,
    ADD COLUMN IF NOT EXISTS attachment_mime TEXT,
    ADD COLUMN IF NOT EXISTS attachment_size INTEGER,
    ADD COLUMN IF NOT EXISTS read_at         TIMESTAMPTZ;

-- content pasa a ser nullable: un mensaje puede ser "solo imagen" sin texto.
-- (LEFT(NULL,80) en el trigger devuelve NULL → lo cubre el CASE más abajo.)
ALTER TABLE public.support_messages
    ALTER COLUMN content DROP NOT NULL;

-- Pero si no hay texto, tiene que haber adjunto. Sin esto un INSERT vacío
-- pasa la RLS y queda un mensaje fantasma.
ALTER TABLE public.support_messages
    DROP CONSTRAINT IF EXISTS support_messages_has_payload;
ALTER TABLE public.support_messages
    ADD CONSTRAINT support_messages_has_payload
        CHECK (
            (content IS NOT NULL AND length(trim(content)) > 0)
            OR attachment_path IS NOT NULL
        );

-- Índice para read receipts: el cliente filtra "mensajes del otro lado sin leer".
CREATE INDEX IF NOT EXISTS idx_support_messages_unread
    ON public.support_messages (thread_id, sender_role)
    WHERE read_at IS NULL;

-- ─── Trigger: actualizar preview con "📎 Imagen" si no hay texto ────
CREATE OR REPLACE FUNCTION public.support_messages_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    preview TEXT;
BEGIN
    preview := CASE
        WHEN NEW.content IS NOT NULL AND length(trim(NEW.content)) > 0
            THEN LEFT(NEW.content, 80)
        WHEN NEW.attachment_path IS NOT NULL
            THEN '📎 Imagen'
        ELSE '(mensaje vacío)'
    END;

    UPDATE public.support_threads
       SET last_message_at      = NEW.created_at,
           last_message_preview = preview,
           unread_for_user      = CASE WHEN NEW.sender_role = 'admin' THEN true  ELSE unread_for_user  END,
           unread_for_admin     = CASE WHEN NEW.sender_role = 'user'  THEN true  ELSE unread_for_admin END
     WHERE id = NEW.thread_id;
    RETURN NEW;
END;
$$;

-- ─── RPC: marcar todo el hilo como leído por el caller ──────────────
-- Llamada por el cliente al abrir el chat. Marca read_at en los mensajes
-- del OTRO role (los míos no necesito marcarlos como leídos por mí mismo)
-- y apaga la bandera unread correspondiente del hilo.
CREATE OR REPLACE FUNCTION public.mark_support_thread_read(p_thread_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    my_id         UUID;
    is_admin      BOOLEAN;
    is_owner      BOOLEAN;
    role_to_mark  TEXT;
BEGIN
    my_id := auth.uid();
    IF my_id IS NULL THEN RETURN; END IF;

    SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = my_id AND p.role = 'admin') INTO is_admin;
    SELECT EXISTS (SELECT 1 FROM public.support_threads t WHERE t.id = p_thread_id AND t.user_id = my_id) INTO is_owner;

    IF NOT (is_admin OR is_owner) THEN RETURN; END IF;

    -- El admin marca como leídos los mensajes del user, y viceversa.
    role_to_mark := CASE WHEN is_admin THEN 'user' ELSE 'admin' END;

    UPDATE public.support_messages
       SET read_at = timezone('utc', now())
     WHERE thread_id = p_thread_id
       AND sender_role = role_to_mark
       AND read_at IS NULL;

    UPDATE public.support_threads
       SET unread_for_admin = CASE WHEN is_admin THEN false ELSE unread_for_admin END,
           unread_for_user  = CASE WHEN is_owner THEN false ELSE unread_for_user  END
     WHERE id = p_thread_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_support_thread_read(BIGINT) TO authenticated;

-- ─── Bucket privado para adjuntos ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('support-attachments', 'support-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- SELECT: cualquier participante del hilo (dueño o admin).
DROP POLICY IF EXISTS "support_attach_read" ON storage.objects;
CREATE POLICY "support_attach_read"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'support-attachments'
        AND EXISTS (
            SELECT 1 FROM public.support_threads t
            WHERE t.id::text = (storage.foldername(name))[1]
              AND (
                  t.user_id = auth.uid()
                  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
              )
        )
    );

-- INSERT: el sender real (segundo folder = uid del que sube) y debe ser
-- participante del hilo (primer folder = thread_id).
DROP POLICY IF EXISTS "support_attach_insert" ON storage.objects;
CREATE POLICY "support_attach_insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'support-attachments'
        AND (storage.foldername(name))[2] = auth.uid()::text
        AND EXISTS (
            SELECT 1 FROM public.support_threads t
            WHERE t.id::text = (storage.foldername(name))[1]
              AND (
                  t.user_id = auth.uid()
                  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
              )
        )
    );

-- Nota: deliberadamente no exponemos UPDATE/DELETE. Una vez subida, la
-- imagen queda inmutable — eliminar mensajes con adjunto es trabajo
-- de un job de mantenimiento separado, no del frontend.

-- ─── Realtime no requiere cambios (la tabla ya está en la publicación
-- desde la migración 25; las columnas nuevas viajan automáticamente).
