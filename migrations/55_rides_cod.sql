-- ============================================================
-- 55 · rides — Cobro Contra Entrega (COD)
-- ============================================================
-- Anexo Higo Envíos v2, Fase E4.1.
--
-- El remitente declara un monto que el chofer cobra en efectivo al
-- destinatario en el momento de la entrega. Higo NO actúa como
-- intermediario financiero del COD; solo audita.

BEGIN;

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS cod_amount     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS cod_currency   CHAR(3) DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS cod_collected  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS cod_collected_at TIMESTAMPTZ;

ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_cod_amount_check;
ALTER TABLE public.rides
  ADD CONSTRAINT rides_cod_amount_check
  CHECK (cod_amount IS NULL OR cod_amount > 0);

-- Audit del cash retenido por el chofer en wallet_movements (mig 43)
-- cuando marca cobrado. Lo hace el frontend con un INSERT explícito;
-- aquí solo creamos un trigger que valida coherencia.
CREATE OR REPLACE FUNCTION public.validate_cod_collection()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cod_collected = true AND OLD.cod_collected = false THEN
    IF NEW.cod_amount IS NULL OR NEW.cod_amount <= 0 THEN
      RAISE EXCEPTION 'cannot_mark_cod_collected_without_amount';
    END IF;
    IF NEW.cod_collected_at IS NULL THEN
      NEW.cod_collected_at := NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_validate_cod ON public.rides;
CREATE TRIGGER rides_validate_cod
  BEFORE UPDATE ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_cod_collection();

COMMIT;
