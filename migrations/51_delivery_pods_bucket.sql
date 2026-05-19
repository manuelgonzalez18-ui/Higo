-- ============================================================
-- 51 · Bucket privado delivery-pods (proof of delivery)
-- ============================================================
-- Anexo Higo Envíos v2, Fase E1.3.
--
-- Bucket para fotos POD del chofer (pickup + delivery) y evidencia de
-- claims del remitente. Estructura de paths:
--   <ride_id>/pickup.jpg
--   <ride_id>/delivery.jpg
--   <ride_id>/claim-<n>.jpg

BEGIN;

-- 1. Crear bucket (privado, no público)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'delivery-pods',
  'delivery-pods',
  false,
  10485760, -- 10 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 2. RLS policies

-- INSERT: solo el chofer asignado al ride (pickup/delivery) o el remitente
--         (para evidencia de claims). Path debe empezar con <ride_id>.
DROP POLICY IF EXISTS delivery_pods_insert ON storage.objects;
CREATE POLICY delivery_pods_insert
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'delivery-pods'
  AND EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id::text = split_part(name, '/', 1)
       AND (
         r.driver_id = auth.uid()
         OR r.user_id = auth.uid()
       )
  )
);

-- SELECT: chofer asignado + remitente + admin
DROP POLICY IF EXISTS delivery_pods_select ON storage.objects;
CREATE POLICY delivery_pods_select
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'delivery-pods'
  AND (
    EXISTS (
      SELECT 1 FROM public.rides r
       WHERE r.id::text = split_part(name, '/', 1)
         AND (r.driver_id = auth.uid() OR r.user_id = auth.uid())
    )
    OR public.is_admin(auth.uid())
  )
);

-- UPDATE/DELETE: prohibido (auditoría — los POD no se modifican)
DROP POLICY IF EXISTS delivery_pods_update ON storage.objects;
DROP POLICY IF EXISTS delivery_pods_delete ON storage.objects;
CREATE POLICY delivery_pods_delete
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'delivery-pods'
  AND public.is_admin(auth.uid())
);

COMMIT;
