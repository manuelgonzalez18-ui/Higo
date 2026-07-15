-- ============================================================
-- 82 · Reactivar RLS en profiles (guard contra toggle manual)
-- ============================================================
--
-- Incidente 2026-07-12 (Supabase Security Advisor, rls_disabled_in_public):
-- la tabla public.profiles apareció con Row Level Security DESACTIVADO en la
-- base viva. La mig 02 lo había activado; se apagó manualmente en algún
-- momento (el toggle del Table Editor es fácil de tocar sin querer). Con RLS
-- off, las policies de las migs 34/72/79 quedan inertes y CUALQUIERA con la
-- anon key puede leer todos los perfiles y hacerse role='admin' (escalada
-- de privilegios que ya se había cerrado).
--
-- Esta migración solo REACTIVA el RLS de forma idempotente. Las policies ya
-- existen (self_read/admin_read/ride_party_read, self_update con role/estado
-- congelados, admin_update); al reactivar RLS vuelven a aplicar.
--
-- No usamos FORCE ROW LEVEL SECURITY: el service_role (endpoints PHP) debe
-- seguir pudiendo saltar RLS vía BYPASSRLS para los flujos server-side.
-- ============================================================

BEGIN;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Verificación (correr aparte):
--   select relrowsecurity from pg_class where relname='profiles';  -- debe ser true
--   select policyname, cmd from pg_policies
--     where schemaname='public' and tablename='profiles' order by cmd;
