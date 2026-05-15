-- ============================================================
-- 23 · Bucket de Supabase Storage para fotos (avatares) de conductores
-- ============================================================
--
-- El endpoint /api/welcome-driver.php sube la foto del conductor a
-- storage/v1/object/avatars/<user_id>/avatar.<ext> usando la
-- SERVICE_ROLE_KEY. Si el bucket no existe el upload falla con
-- "Bucket not found" (404 envuelto en un 400). Esta migración crea
-- el bucket público y las policies mínimas para que cada conductor
-- pueda gestionar su propio avatar desde la app.

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública (los avatares se muestran en la UI sin auth).
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'avatars');

-- Cada usuario autenticado puede subir su propio avatar (carpeta = uid).
DROP POLICY IF EXISTS "avatars_upload_own" ON storage.objects;
CREATE POLICY "avatars_upload_own"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Cada usuario autenticado puede sobreescribir su propio avatar.
DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
CREATE POLICY "avatars_update_own"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Cada usuario autenticado puede borrar su propio avatar.
DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
