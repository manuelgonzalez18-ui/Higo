-- ============================================================
-- 53 · Validación de peso vs vehicle_type en envíos
-- ============================================================
-- Anexo Higo Envíos v2, Fase E2.2.
--
-- Higo Moto ≤ 5kg, Higo Carro ≤ 25kg, Higo Camioneta ≤ 50kg.
-- Trigger BEFORE INSERT bloquea con mensaje claro si el peso excede.

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_delivery_weight()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_weight_bucket TEXT;
  v_max_kg NUMERIC;
  v_weight_kg NUMERIC;
BEGIN
  IF NEW.service_type <> 'delivery' THEN
    RETURN NEW;
  END IF;

  v_weight_bucket := NEW.delivery_info->>'package_weight_kg';
  IF v_weight_bucket IS NULL THEN
    -- Sin peso declarado, lo dejamos pasar (el frontend valida required).
    RETURN NEW;
  END IF;

  -- Map de bucket textual a tope numérico
  v_weight_kg := CASE v_weight_bucket
    WHEN '<1'    THEN 1
    WHEN '1-5'   THEN 5
    WHEN '5-10'  THEN 10
    WHEN '10-25' THEN 25
    WHEN '25-50' THEN 50
    WHEN '>50'   THEN 999
    ELSE NULL
  END;

  IF v_weight_kg IS NULL THEN
    RAISE EXCEPTION 'invalid_weight_bucket: %', v_weight_bucket;
  END IF;

  v_max_kg := CASE NEW.ride_type
    WHEN 'moto'      THEN 5
    WHEN 'standard'  THEN 25
    WHEN 'van'       THEN 50
    WHEN 'camioneta' THEN 50
    ELSE 25
  END;

  IF v_weight_kg > v_max_kg THEN
    RAISE EXCEPTION 'package_too_heavy_for_vehicle: max % kg for %, got bucket %',
      v_max_kg, NEW.ride_type, v_weight_bucket;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_validate_delivery_weight ON public.rides;
CREATE TRIGGER rides_validate_delivery_weight
  BEFORE INSERT ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_delivery_weight();

COMMIT;
