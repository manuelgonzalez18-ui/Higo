-- ============================================================
-- 28 · Borrar mensajes propios del chat de soporte
-- ============================================================
-- Fase 5 (paso 2/4). El sender puede eliminar sus propios mensajes;
-- quedan como "Mensaje eliminado" en gris para la otra parte (tipo
-- WhatsApp). No exponemos UPDATE general sobre support_messages —
-- lo hacemos vía RPC SECURITY DEFINER para que solo se pueda tocar
-- deleted_at, nunca content/attachment de un mensaje ya enviado.

-- ─── Columna ────────────────────────────────────────────────────────
ALTER TABLE public.support_messages
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ─── RPC: marca el mensaje propio como eliminado ────────────────────
CREATE OR REPLACE FUNCTION public.delete_support_message(p_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    msg_row public.support_messages%ROWTYPE;
BEGIN
    SELECT * INTO msg_row FROM public.support_messages WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'message_not_found';
    END IF;
    IF msg_row.sender_id <> auth.uid() THEN
        RAISE EXCEPTION 'forbidden';
    END IF;
    -- Idempotente: si ya estaba marcado, no rompemos.
    IF msg_row.deleted_at IS NOT NULL THEN
        RETURN;
    END IF;

    UPDATE public.support_messages
       SET deleted_at = timezone('utc', now())
     WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_support_message(BIGINT) TO authenticated;

-- ─── Storage: permitir DELETE de adjuntos propios ───────────────────
-- Path: <thread>/<sender_uid>/<archivo>. El sender (segundo folder)
-- puede borrar el blob del bucket cuando elimina el mensaje. El
-- frontend lo llama best-effort después del RPC — si falla, el msg
-- queda como "eliminado" igual y el blob se vuelve huérfano (job de
-- mantenimiento futuro lo barre).
DROP POLICY IF EXISTS "support_attach_delete" ON storage.objects;
CREATE POLICY "support_attach_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'support-attachments'
        AND (storage.foldername(name))[2] = auth.uid()::text
    );
