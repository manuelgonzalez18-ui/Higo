-- Higo Pay: weekly driver membership pricing update (October 2026).
-- 7-day plans: moto USD 4; car/standard and van USD 7.
-- Monthly plans and historical paid memberships remain untouched.
begin;

update public.driver_membership_plans
set amount = case code
    when 'moto-weekly' then 4
    when 'car-weekly' then 7
    when 'van-weekly' then 7
end,
    updated_at = now()
where (code, vehicle_type, period, currency) in (
    ('moto-weekly','moto','weekly','USD'),
    ('car-weekly','standard','weekly','USD'),
    ('van-weekly','van','weekly','USD')
);

commit;
