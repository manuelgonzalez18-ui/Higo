-- ============================================================
-- 23 · Bucket público de Supabase Storage para avatares y QR de pago
-- ============================================================
-- En Hostinger venimos creando el bucket on-demand desde welcome-driver.php
-- (self-heal con service role). Esta migración lo deja idempotente para
-- instalaciones nuevas y entornos de staging.

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública (avatares y QR de pago se muestran sin autenticación).
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'avatars');

-- El conductor sube/actualiza su propia foto y QR (path = <user_id>/...).
DROP POLICY IF EXISTS "avatars_owner_write" ON storage.objects;
CREATE POLICY "avatars_owner_write"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
