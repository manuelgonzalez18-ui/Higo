-- Higuerote launch calibration based on the local tariff sheet reviewed
-- on 2026-10-14.
--
-- Decision:
--   * Carro (`standard`) and Camioneta (`van`) use the same passenger fare.
--   * Both memberships cost USD 20/month.
--   * Moto remains unchanged pending a separate calibration.
--   * per_minute stays at 0 during launch calibration.

update public.pricing_config
set base = 1.70,
    minimum_fare = 1.70,
    per_km = 0.60,
    per_minute = 0,
    included_km = 1,
    delivery_fee = 2.00,
    wait_per_min = 0.10,
    free_wait_minutes = 3,
    stop_fee = 1.00,
    maximum_multiplier = 1.30
where vehicle_type in ('standard', 'van');

update public.membership_plans
set amount_usd = 20,
    amount_bs = case
        when plan = 'van' then (select p.amount_bs from public.membership_plans p where p.plan = 'standard' limit 1)
        else amount_bs
    end,
    bs_updated_at = case
        when plan = 'van' then (select p.bs_updated_at from public.membership_plans p where p.plan = 'standard' limit 1)
        else bs_updated_at
    end,
    display_name = case plan
        when 'standard' then 'Higo Carro'
        when 'van' then 'Higo Camioneta'
        else display_name
    end
where plan in ('standard', 'van');

notify pgrst, 'reload schema';
