-- ============================================================
-- 79 · Blindar campos de membresía en profiles_self_update
-- ============================================================
--
-- Problema (auditoría profunda 2026-07-02, A2):
-- La policy `profiles_self_update` (mig 72) solo congela `role` en su
-- WITH CHECK. Un usuario puede actualizar su propia fila cambiando
-- `subscription_status` y `last_payment_date`:
--
--   update public.profiles
--      set subscription_status = 'active', last_payment_date = now()
--    where id = auth.uid();
--
-- Eso equivale a auto-otorgarse una membresía activa (si algún flujo lee
-- profiles.subscription_status como fuente de solvencia), saltándose el
-- pago. Es el mismo tipo de bypass que la mig 77 cerró en las RPC.
--
-- Fix:
-- Extender el WITH CHECK para que un self-update NO pueda cambiar
-- `subscription_status` ni `last_payment_date` (solo mutables por
-- service_role — vía el trigger sync_driver_subscription_status de la
-- mig 16 — o por admins vía profiles_admin_update). `role` sigue
-- congelado. El resto (curr_lat/lng, fcm_token, full_name, avatar, etc.)
-- permanece editable para no romper tracking ni la edición de perfil.
--
-- Idempotente. Rollback al final.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;

CREATE POLICY "profiles_self_update"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
    AND subscription_status IS NOT DISTINCT FROM
        (SELECT subscription_status FROM public.profiles WHERE id = auth.uid())
    AND last_payment_date IS NOT DISTINCT FROM
        (SELECT last_payment_date FROM public.profiles WHERE id = auth.uid())
);

COMMIT;

-- ── Verificación manual sugerida tras aplicar ────────────────────────
-- Como driver NO admin, desde supabase JS:
--   await supabase.from('profiles')
--     .update({ subscription_status: 'active', last_payment_date: new Date() })
--     .eq('id', userId);
-- Debe NO cambiar la fila (WITH CHECK la filtra). Un update legítimo de
-- curr_lat/curr_lng o full_name debe seguir funcionando.
--
-- ============================================================
-- Rollback (vuelve a permitir cambiar subscription_status/last_payment_date):
-- ============================================================
-- BEGIN;
-- DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
-- CREATE POLICY "profiles_self_update" ON public.profiles
--   FOR UPDATE TO authenticated
--   USING (auth.uid() = id)
--   WITH CHECK (auth.uid() = id
--     AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()));
-- COMMIT;
