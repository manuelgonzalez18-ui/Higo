-- ============================================================
-- 21 · Soporte de comprobantes + tipo de pago en payment_reports
-- ============================================================

ALTER TABLE public.payment_reports
    ADD COLUMN IF NOT EXISTS payment_type TEXT
        CHECK (payment_type IN ('pm_banesco','pm_otros','tf_banesco','tf_otros')),
    ADD COLUMN IF NOT EXISTS receipt_url  TEXT;

-- Bucket de Supabase Storage para comprobantes de pago
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-receipts', 'payment-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Conductores pueden subir sus propios comprobantes
DROP POLICY IF EXISTS "drivers_upload_own_receipts" ON storage.objects;
CREATE POLICY "drivers_upload_own_receipts"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'payment-receipts'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Conductores pueden leer sus propios comprobantes
DROP POLICY IF EXISTS "drivers_read_own_receipts" ON storage.objects;
CREATE POLICY "drivers_read_own_receipts"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'payment-receipts'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Admins leen todos los comprobantes
DROP POLICY IF EXISTS "admins_read_all_receipts" ON storage.objects;
CREATE POLICY "admins_read_all_receipts"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'payment-receipts'
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );
