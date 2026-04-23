-- ============================================================
-- HOTFIX · Columnas de confirmación de pago en rides
-- ============================================================
-- Ejecuta este script UNA vez en el SQL Editor de Supabase si ves el
-- error: "Could not find the 'payment_confirmed_by_driver' column of
-- 'rides' in the schema cache".
--
-- Motivo: la migración 13_add_payment_and_membership.sql no se había
-- aplicado en la base de datos productiva, o PostgREST mantiene en
-- caché un esquema anterior.

ALTER TABLE public.rides
    ADD COLUMN IF NOT EXISTS payment_method              TEXT    DEFAULT 'pago_movil',
    ADD COLUMN IF NOT EXISTS payment_reference           TEXT,
    ADD COLUMN IF NOT EXISTS payment_confirmed_by_user   BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS payment_confirmed_by_driver BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS payment_confirmed_at        TIMESTAMPTZ;

-- Fuerza a PostgREST (la API REST de Supabase) a recargar su schema
-- cache al instante, sin esperar al reload periódico.
NOTIFY pgrst, 'reload schema';
