-- ============================================================
-- 42 · Bucket privado driver-docs (Storage)
-- ============================================================
-- Fase 10 D.C1 · 2/4. Storage para los archivos referenciados por
-- driver_documents.file_path (mig 41).
--
-- A diferencia de 'avatars' (público), driver-docs es PRIVADO porque
-- contiene PII pesada: cédula, licencia, póliza. Solo:
--   - El dueño (chofer) lee/escribe sus propios docs.
--   - Los admins leen todo.
-- Las URLs públicas no funcionan; el frontend usa signed URLs con
-- TTL corto (5 min) para visualizar los docs en revisión.
--
-- Path convention: <user_id>/<document_type>-<timestamp>.<ext>
-- Ej: 7f3b...e2/cedula-1717012345.jpg

INSERT INTO storage.buckets (id, name, public)
VALUES ('driver-docs', 'driver-docs', false)
ON CONFLICT (id) DO NOTHING;

-- SELECT: dueño + admin.
DROP POLICY IF EXISTS "driver_docs_owner_read" ON storage.objects;
CREATE POLICY "driver_docs_owner_read"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'driver-docs'
        AND (
            (storage.foldername(name))[1] = auth.uid()::text
            OR public.is_admin(auth.uid())
        )
    );

-- INSERT: dueño escribe en su propio folder.
DROP POLICY IF EXISTS "driver_docs_owner_write" ON storage.objects;
CREATE POLICY "driver_docs_owner_write"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'driver-docs'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- UPDATE: dueño puede sobreescribir su propio archivo (resubmit).
DROP POLICY IF EXISTS "driver_docs_owner_update" ON storage.objects;
CREATE POLICY "driver_docs_owner_update"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'driver-docs'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'driver-docs'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- DELETE: dueño puede borrar (cleanup tras rechazo / cambio de doc).
-- Admins también, por consistencia.
DROP POLICY IF EXISTS "driver_docs_owner_delete" ON storage.objects;
CREATE POLICY "driver_docs_owner_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'driver-docs'
        AND (
            (storage.foldername(name))[1] = auth.uid()::text
            OR public.is_admin(auth.uid())
        )
    );
