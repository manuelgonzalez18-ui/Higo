-- ============================================================
-- 31 · Recalcular last_message_preview al eliminar
-- ============================================================
-- Fase 6 (paso 1/4). En la migración 28 agregamos delete_support_message,
-- pero el last_message_preview del listado del admin es "sticky" (solo
-- lo escribe el trigger AFTER INSERT). Resultado: si eliminás el último
-- mensaje del hilo, el listado sigue mostrando el texto viejo — espía
-- el contenido del mensaje borrado.
-- Solución: trigger AFTER UPDATE OF deleted_at que recalcula preview
-- y last_message_at a partir del último mensaje vivo del hilo.

CREATE OR REPLACE FUNCTION public.support_messages_after_delete_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    new_preview TEXT;
    new_last_at TIMESTAMPTZ;
BEGIN
    -- Solo nos importa la transición vivo → eliminado.
    IF NEW.deleted_at IS NULL OR OLD.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Último mensaje vivo del hilo (puede no haber ninguno).
    SELECT m.created_at,
           CASE
               WHEN m.content IS NOT NULL AND length(trim(m.content)) > 0
                   THEN LEFT(m.content, 80)
               WHEN m.attachment_path IS NOT NULL THEN
                   CASE
                       WHEN m.attachment_mime LIKE 'image/%'      THEN '🖼️ Imagen'
                       WHEN m.attachment_mime LIKE 'audio/%'      THEN '🎤 Audio'
                       WHEN m.attachment_mime = 'application/pdf' THEN '📄 PDF'
                       ELSE '📎 Archivo'
                   END
               ELSE '(mensaje vacío)'
           END
      INTO new_last_at, new_preview
      FROM public.support_messages m
     WHERE m.thread_id = NEW.thread_id
       AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC
     LIMIT 1;

    IF new_last_at IS NULL THEN
        -- No quedó ningún mensaje vivo. Conservamos last_message_at para
        -- no romper el orden del listado, pero limpiamos el preview.
        UPDATE public.support_threads
           SET last_message_preview = '(mensaje eliminado)'
         WHERE id = NEW.thread_id;
    ELSE
        UPDATE public.support_threads
           SET last_message_at      = new_last_at,
               last_message_preview = new_preview
         WHERE id = NEW.thread_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_messages_after_delete_update ON public.support_messages;
CREATE TRIGGER support_messages_after_delete_update
    AFTER UPDATE OF deleted_at ON public.support_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.support_messages_after_delete_update();
