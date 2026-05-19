-- ============================================================
-- 62 · Categorías especiales de envío
-- ============================================================
-- Anexo Higo Envíos v2, Fase E7.2.
--
-- Categoría se guarda dentro de delivery_info.category (sin nueva
-- columna estructural). Esta migración crea una función de validación
-- y la engancha al trigger BEFORE INSERT existente.

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_delivery_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat TEXT;
BEGIN
  IF NEW.service_type <> 'delivery' THEN
    RETURN NEW;
  END IF;

  v_cat := NEW.delivery_info->>'category';

  -- Categoría opcional. Si viene, debe estar en la lista permitida.
  IF v_cat IS NOT NULL AND v_cat NOT IN
     ('normal','fragile','refrigerated','documents','electronics') THEN
    RAISE EXCEPTION 'invalid_delivery_category: %', v_cat;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_validate_delivery_category ON public.rides;
CREATE TRIGGER rides_validate_delivery_category
  BEFORE INSERT ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_delivery_category();

COMMIT;
