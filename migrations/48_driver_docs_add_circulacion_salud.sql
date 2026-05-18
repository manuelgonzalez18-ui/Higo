-- ============================================================
-- 48 · Sumar Certificado de Circulación + Certificado de Salud
-- ============================================================
-- El admin requiere 2 docs más para habilitar a un chofer:
--   - circulacion: Certificado de Circulación del Vehículo
--   - cert_salud:  Certificado de Salud del conductor
-- Esto bumpea el total de docs requeridos de 4 a 6.
--
-- Impacto en choferes existentes:
-- - Los choferes con subscription_status='active' (grandfathered en
--   el gate de DriverDashboard) NO se ven afectados — siguen pudiendo
--   ponerse online sin docs nuevos.
-- - Los choferes en flujo nuevo (post mig 41) que tenían 4/4 docs
--   aprobados quedan a 4/6 — driver_is_fully_approved retorna false
--   hasta que carguen los 2 nuevos. El gate los redirige a
--   /driver/onboarding al intentar conectarse.

-- ─── Update CHECK constraint del document_type ──────────────────────
-- Postgres no permite ALTER CHECK directamente; hay que DROP + ADD.
-- El nombre default es <tabla>_<columna>_check.
ALTER TABLE public.driver_documents
    DROP CONSTRAINT IF EXISTS driver_documents_document_type_check;

ALTER TABLE public.driver_documents
    ADD CONSTRAINT driver_documents_document_type_check
    CHECK (document_type IN (
        'cedula',         -- documento de identidad (CI venezolana)
        'licencia',       -- licencia de conducir vigente
        'rcv',            -- póliza de responsabilidad civil del vehículo
        'vehicle_photo',  -- foto del vehículo (placa visible)
        'circulacion',    -- certificado de circulación del vehículo (mig 48)
        'cert_salud'      -- certificado de salud del chofer (mig 48)
    ));

-- ─── Update RPC driver_is_fully_approved ──────────────────────────
-- Antes exigía COUNT = 4; ahora 6. Mismo enum del CHECK arriba.
CREATE OR REPLACE FUNCTION public.driver_is_fully_approved(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((
        SELECT COUNT(DISTINCT document_type) = 6
          FROM public.driver_documents
         WHERE user_id = p_uid
           AND status  = 'approved'
           AND document_type IN (
               'cedula', 'licencia', 'rcv', 'vehicle_photo',
               'circulacion', 'cert_salud'
           )
    ), false);
$$;

REVOKE ALL ON FUNCTION public.driver_is_fully_approved(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_is_fully_approved(UUID) TO authenticated;
