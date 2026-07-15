-- ============================================================
-- 84 · Arreglar profiles_self_update (rompía login/registro)
-- ============================================================
--
-- Incidente 2026-07-14: tras reactivar RLS (mig 82/83), las cuentas
-- existentes se autoexpulsaban ("Se ha iniciado sesión en otro
-- dispositivo") y no se podía iniciar sesión ni registrar. Causa: la
-- policy profiles_self_update (mig 72/79) congela role/subscription_status/
-- last_payment_date con un SUBQUERY CRUDO sobre public.profiles DENTRO de
-- una policy de public.profiles. Al evaluar el WITH CHECK, ese subquery
-- re-dispara las policies de profiles y termina fallando (contexto RLS /
-- recursión), lo que RECHAZA la escritura de current_session_id que hace
-- la app en cada login (AuthPage.jsx / App.jsx SessionWatch). Con el
-- session_id sin guardar, el valor local ≠ el de la base → la app cree que
-- la sesión se abrió en otro lado y cierra sesión.
--
-- Fix: mover la lectura de los campos congelados a una función
-- SECURITY DEFINER (como ya hace public.is_admin), que lee profiles SIN
-- pasar por RLS → sin recursión, NULL-safe. La policy queda: el usuario
-- puede actualizar SU fila y cualquier columna MENOS role/subscription_
-- status/last_payment_date (esos quedan congelados = anti-escalada y
-- anti-auto-activación de membresía).
-- ============================================================

BEGIN;

-- Helper SECURITY DEFINER: ¿los valores nuevos de los campos sensibles
-- coinciden con los actuales del propio caller? (bypassa RLS al leer).
CREATE OR REPLACE FUNCTION public.profiles_sensitive_unchanged(
    p_role   TEXT,
    p_sub    TEXT,
    p_lastpay TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.profiles
         WHERE id = auth.uid()
           AND role                IS NOT DISTINCT FROM p_role
           AND subscription_status IS NOT DISTINCT FROM p_sub
           AND last_payment_date   IS NOT DISTINCT FROM p_lastpay
    );
$$;

REVOKE EXECUTE ON FUNCTION public.profiles_sensitive_unchanged(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.profiles_sensitive_unchanged(TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- Reescribir la policy de self-update usando el helper (sin subquery crudo).
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id
        AND public.profiles_sensitive_unchanged(role, subscription_status, last_payment_date)
    );

COMMIT;

-- Verificación tras aplicar:
--   -- como usuario NO admin, actualizar un campo normal debe FUNCIONAR:
--   update public.profiles set current_session_id = gen_random_uuid()::text where id = auth.uid();
--   -- intentar escalar debe FALLAR (0 filas / error de policy):
--   update public.profiles set role = 'admin' where id = auth.uid();
