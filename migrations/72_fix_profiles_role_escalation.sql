-- ============================================================
-- 72 · Fix escalada de privilegios via UPDATE de `profiles.role`
-- ============================================================
--
-- Problema (auditoría automática #3, issue #44):
-- La policy "Users can update own profile" sobre public.profiles permite
-- a cualquier usuario autenticado hacer UPDATE de su propia fila sin
-- WITH CHECK que restrinja la columna `role`. Por lo tanto:
--
--   update public.profiles set role = 'admin' where id = auth.uid();
--
-- ejecutado desde el cliente Supabase con la anon key, escala al
-- usuario a admin. A partir de ahí AdminGuard.jsx (que lee profile.role)
-- da paso a todo /admin/* y las RPC con is_admin() lo aceptan.
--
-- Fix:
-- Reemplazar la policy por dos:
--   1) profiles_self_update: el usuario puede actualizar SU fila, pero
--      WITH CHECK garantiza que `role` y `status` (campos sensibles)
--      no cambian respecto del valor previo.
--   2) profiles_admin_update: los admins pueden actualizar cualquier
--      fila incluyendo `role` (vía función is_admin con SECURITY DEFINER
--      para evitar recursión).
--
-- Backfill: ningún dato cambia. Solo se reescriben policies.
--
-- Rollback: si esta migración rompe algún flujo legítimo, restaurar la
-- policy original con `using ( auth.uid() = id );` (ver mig 02).

BEGIN;

-- ── Helper: función is_admin SECURITY DEFINER (idempotente) ──────────
-- Permite a las policies preguntar "¿el caller es admin?" sin disparar
-- la policy de profiles (que generaría recursión).
CREATE OR REPLACE FUNCTION public.is_admin(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_uid AND role = 'admin'
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;

-- ── Reemplazar la policy laxa ────────────────────────────────────────
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;

-- 1) Self-update: solo su fila, sin tocar role.
--    `status` queda libre porque drivers lo cambian legítimamente entre
--    'online'/'offline'/'busy' desde la app. Si se quiere endurecer más,
--    agregar enum check en otra migración.
CREATE POLICY "profiles_self_update"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
);

-- 2) Admin-update: admins pueden tocar cualquier fila, incluido role.
CREATE POLICY "profiles_admin_update"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

COMMIT;

-- ── Verificación manual sugerida tras aplicar ────────────────────────
-- Como usuario passenger (NO admin), ejecutar desde supabase JS:
--   await supabase.from('profiles').update({ role: 'admin' }).eq('id', userId);
-- Debe devolver { data: [], error: null } (RLS filtró el WITH CHECK,
-- el row no se actualiza) o un error de policy. NO debe escalar.
