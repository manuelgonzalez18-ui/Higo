-- ============================================================
-- 27 · Preview del trigger según tipo de adjunto
-- ============================================================
-- Fase 5 (paso 1/4). En la migración 26 el preview de last_message_preview
-- caía siempre a "📎 Imagen" cuando no había texto, porque solo se subían
-- imágenes. Ahora el chat soporta también PDF y audio, así que el preview
-- tiene que reflejar el tipo correcto.

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
        WHEN NEW.attachment_path IS NOT NULL THEN
            CASE
                WHEN NEW.attachment_mime LIKE 'image/%'           THEN '🖼️ Imagen'
                WHEN NEW.attachment_mime LIKE 'audio/%'           THEN '🎤 Audio'
                WHEN NEW.attachment_mime = 'application/pdf'      THEN '📄 PDF'
                ELSE '📎 Archivo'
            END
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
