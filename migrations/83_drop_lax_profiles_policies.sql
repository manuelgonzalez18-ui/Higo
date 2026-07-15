-- ============================================================
-- 83 · Borrar policies laxas remanentes en profiles
-- ============================================================
--
-- Al reactivar RLS en profiles (mig 82 / incidente 2026-07-12) se vio que
-- la base viva tenía, además de las policies correctas, TRES policies laxas
-- creadas/heredadas a mano que NUNCA se dropearon y que reabren los agujeros
-- (en Postgres las policies permisivas del mismo comando se combinan con OR,
-- así que una sola laxa anula a todas las estrictas):
--
--   • "Enable read access for all users"  (SELECT, USING true)
--       → cualquiera lee TODOS los perfiles (PII). Plantilla default de
--         Supabase agregada desde el Table Editor.
--   • "Users can update own profile"       (UPDATE, sin WITH CHECK de role)
--   • "Users can update their own profile" (UPDATE, ídem)
--       → permiten `update profiles set role='admin'` (escalada), anulando
--         profiles_self_update (mig 72/79).
--
-- Se dropean. Quedan solo las correctas: profiles_self_read /
-- profiles_admin_read / profiles_ride_party_read (SELECT, mig 34),
-- profiles_self_update / profiles_admin_update (UPDATE, mig 72/79),
-- "Users can insert their own profile" (INSERT, mig 02, with check id).
--
-- Idempotente (DROP ... IF EXISTS).
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "Enable read access for all users"  ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"       ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

COMMIT;

-- Verificación (correr aparte): deben quedar 6 policies
--   select policyname, cmd from pg_policies
--     where schemaname='public' and tablename='profiles' order by cmd;
