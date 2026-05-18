-- ============================================================
-- 38 · user_preferences — onboarding + datos personalizados del user
-- ============================================================
-- Fase 9 paso D.P1 del roadmap.
--
-- Una fila por user (PK = user_id, no auto-id). Se crea al completar
-- el primer paso del onboarding y se actualiza incrementalmente.
-- `onboarded_at` es el sentinel que App.jsx usa para decidir si
-- redirigir a /onboarding al login. Se setea cuando:
--   - El user completa el flow (paso final).
--   - El user explícitamente saltea desde la pantalla welcome.
-- En ambos casos respetamos la decisión: no se vuelve a gateear.
--
-- Las direcciones home/work se usan en RequestRidePage para sugerir
-- destinos rápidos (D.P6 destinos frecuentes, Fase 15). default_
-- payment_method se usa en ConfirmTripPage para preseleccionar el
-- método (D.P12, Fase 15).

CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id                 UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    home_address            TEXT,
    home_lat                NUMERIC,
    home_lng                NUMERIC,
    work_address            TEXT,
    work_lat                NUMERIC,
    work_lng                NUMERIC,
    -- 'pago_movil' | 'cash' | 'higopay' (matches rides.payment_method).
    default_payment_method  TEXT        CHECK (default_payment_method IN ('pago_movil','cash','higopay')),
    onboarded_at            TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_onboarded
    ON public.user_preferences (onboarded_at)
    WHERE onboarded_at IS NULL;

-- Trigger para auto-update de updated_at.
CREATE OR REPLACE FUNCTION public.tg_user_preferences_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := timezone('utc', now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_preferences_touch ON public.user_preferences;
CREATE TRIGGER user_preferences_touch
    BEFORE UPDATE ON public.user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_user_preferences_touch();

-- RLS: el user maneja solo sus propias preferencias. Admins también
-- por consistencia (soporte / debugging).
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_preferences_owner_all" ON public.user_preferences;
CREATE POLICY "user_preferences_owner_all"
    ON public.user_preferences FOR ALL TO authenticated
    USING      (user_id = auth.uid() OR public.is_admin(auth.uid()))
    WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));
