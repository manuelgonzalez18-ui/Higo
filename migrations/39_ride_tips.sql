-- ============================================================
-- 39 · ride_tips — propinas post-viaje
-- ============================================================
-- Fase 9 paso D.P4 del roadmap (cierra Fase 9).
--
-- Permite al pasajero dejar propina al rating post-viaje. Sin
-- procesamiento monetario propio: el monto queda registrado para
-- que el conductor lo cobre como suma al precio (o que se descuente
-- de un saldo HigoPay futuro). El tip_amount NO se suma a `price`
-- en la columna original — quedan separados para auditoría.

ALTER TABLE public.rides
    ADD COLUMN IF NOT EXISTS tip_amount  NUMERIC     NOT NULL DEFAULT 0
        CHECK (tip_amount >= 0);
ALTER TABLE public.rides
    ADD COLUMN IF NOT EXISTS tip_paid_at TIMESTAMPTZ;

-- Policy faltante: hoy NO existe una policy explícita en migrations/
-- que permita al pasajero hacer UPDATE en su propio ride. submitRating
-- y confirmPayment funcionan en prod, por lo que asumimos que se
-- agregó manualmente en Supabase Studio en algún momento. La
-- documentamos acá para tenerla versionada y consistente con el
-- nuevo UPDATE de tip.
--
-- Riesgo conocido: permite UPDATE de cualquier columna del propio
-- ride (incluyendo price, status, etc). Mitigación a futuro:
-- (a) trigger BEFORE UPDATE que rechace cambios fuera de
-- {rating, feedback, tip_amount, tip_paid_at, payment_confirmed_by_user,
-- payment_method}, o
-- (b) RPC SECURITY DEFINER set_ride_rating_and_tip() que valida
-- columnas. Por ahora aceptamos el riesgo — mismo que ya teníamos.
DROP POLICY IF EXISTS "Passengers can update their own ride" ON public.rides;
CREATE POLICY "Passengers can update their own ride"
    ON public.rides FOR UPDATE TO authenticated
    USING      (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
