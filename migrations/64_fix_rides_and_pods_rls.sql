-- ============================================================
-- 64 · Corrección de Políticas RLS para Rides y Delivery Pods
-- ============================================================

BEGIN;

-- 1. Políticas RLS de SELECT en la tabla public.rides
DROP POLICY IF EXISTS "Drivers can view their assigned rides" ON public.rides;
CREATE POLICY "Drivers can view their assigned rides"
ON public.rides FOR SELECT TO authenticated
USING (
  driver_id = auth.uid()
);

DROP POLICY IF EXISTS "Passengers can view their own rides" ON public.rides;
CREATE POLICY "Passengers can view their own rides"
ON public.rides FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
);

-- 2. Política RLS UPDATE en storage.objects para el bucket 'delivery-pods'
-- Requerido para soportar la opción { upsert: true } en el cliente (reintentos o cambio de foto)
DROP POLICY IF EXISTS delivery_pods_update ON storage.objects;
CREATE POLICY delivery_pods_update
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'delivery-pods'
  AND EXISTS (
    SELECT 1 FROM public.rides r
     WHERE r.id::text = split_part(name, '/', 1)
       AND (r.driver_id = auth.uid() OR r.user_id = auth.uid())
  )
);

COMMIT;
