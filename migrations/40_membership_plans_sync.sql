-- ============================================================
-- 40 · membership_plans sync — precios + display_name
-- ============================================================
-- Detectamos que migrations/16_higo_pay.sql sembró los planes con
-- precios $5 / $10 / $15 mientras que higodriver.com publica
-- $10 / $20 / $25 (Moto / Carro / Carroza). Si la prod DB no fue
-- actualizada manualmente, el RPC register_membership_payment estaba
-- aceptando como válidos pagos al precio viejo (95% del amount_bs
-- de la fila stale).
--
-- Esta migración:
--   1. Agrega columna display_name (label amigable que renderea el
--      frontend en HigoPayPage — los choferes ven "Higo Carro" en
--      lugar de 'standard' del enum técnico).
--   2. UPDATE absoluto a los valores canónicos según higodriver.com.
--      Idempotente: si prod ya estaba a $10/$20/$25, no cambia nada.
--
-- Nota: amount_bs queda como estaba (null o el último valor calculado
-- contra BCV). El cron / cálculo BCV lo refresca cuando corresponda.
-- No tocamos amount_bs acá para no introducir un valor stale.

ALTER TABLE public.membership_plans
    ADD COLUMN IF NOT EXISTS display_name TEXT;

UPDATE public.membership_plans
   SET amount_usd   = 10,
       display_name = 'Higo Moto'
 WHERE plan = 'moto';

UPDATE public.membership_plans
   SET amount_usd   = 20,
       display_name = 'Higo Carro'
 WHERE plan = 'standard';

UPDATE public.membership_plans
   SET amount_usd   = 25,
       display_name = 'Higo Camioneta'
 WHERE plan = 'van';

-- Si por alguna razón la fila no existe (mig 16 nunca corrió en este
-- entorno), upsert defensivo para crearla.
INSERT INTO public.membership_plans (plan, period, amount_usd, amount_bs, bs_updated_at, active, display_name)
VALUES
    ('moto',     'monthly', 10, NULL, NULL, TRUE, 'Higo Moto'),
    ('standard', 'monthly', 20, NULL, NULL, TRUE, 'Higo Carro'),
    ('van',      'monthly', 25, NULL, NULL, TRUE, 'Higo Camioneta')
ON CONFLICT (plan) DO UPDATE
   SET amount_usd   = EXCLUDED.amount_usd,
       display_name = EXCLUDED.display_name;
