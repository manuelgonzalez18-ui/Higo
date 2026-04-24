-- ============================================================
-- 15 · Configuración de tarifas editable desde admin
-- ============================================================
-- Antes las tarifas estaban hardcodeadas en RequestRidePage.jsx.
-- Ahora viven en DB y el admin puede editarlas sin redeploy.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pricing_config (
    vehicle_type    TEXT PRIMARY KEY CHECK (vehicle_type IN ('moto', 'standard', 'van')),
    base            NUMERIC NOT NULL CHECK (base >= 0),
    per_km          NUMERIC NOT NULL CHECK (per_km >= 0),
    delivery_fee    NUMERIC NOT NULL CHECK (delivery_fee >= 0),
    wait_per_min    NUMERIC NOT NULL CHECK (wait_per_min >= 0),
    stop_fee        NUMERIC NOT NULL DEFAULT 1.00 CHECK (stop_fee >= 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      UUID REFERENCES public.profiles(id)
);

-- Seed con los valores que estaban hardcodeados en RequestRidePage.jsx:74-78.
INSERT INTO public.pricing_config (vehicle_type, base, per_km, delivery_fee, wait_per_min, stop_fee) VALUES
    ('moto',     1.00, 0.25, 0.50, 0.05, 0.50),
    ('standard', 1.50, 0.40, 1.50, 0.08, 1.00),
    ('van',      1.70, 0.60, 2.00, 0.10, 1.00)
ON CONFLICT (vehicle_type) DO NOTHING;

ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

-- Lectura pública: el frontend necesita las tarifas para cotizar viajes
-- antes de que el usuario se autentique.
DROP POLICY IF EXISTS "anyone_read_pricing" ON public.pricing_config;
CREATE POLICY "anyone_read_pricing"
    ON public.pricing_config FOR SELECT
    TO anon, authenticated
    USING (TRUE);

-- Solo admins pueden modificar.
DROP POLICY IF EXISTS "admins_manage_pricing" ON public.pricing_config;
CREATE POLICY "admins_manage_pricing"
    ON public.pricing_config FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Trigger para mantener updated_at y updated_by frescos.
CREATE OR REPLACE FUNCTION public.touch_pricing_config()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_pricing_config ON public.pricing_config;
CREATE TRIGGER trg_touch_pricing_config
    BEFORE UPDATE ON public.pricing_config
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_pricing_config();
