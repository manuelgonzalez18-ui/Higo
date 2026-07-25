-- Reconcile legacy driver_memberships checks with the membership-first catalog.
--
-- Historical schemas restricted:
--   plan   -> moto | standard | van
--   status -> active | expired | refunded
--
-- The current catalog stores plan codes such as car-monthly whenever plan_id
-- is present, and audited cancellation marks a membership as voided. Keep
-- legacy rows compatible while allowing the current application contract.

begin;

alter table public.driver_memberships
    drop constraint if exists driver_memberships_plan_check;

alter table public.driver_memberships
    add constraint driver_memberships_plan_check
    check (
        plan_id is not null
        or plan is null
        or plan in ('moto', 'standard', 'van')
    )
    not valid;

alter table public.driver_memberships
    validate constraint driver_memberships_plan_check;

alter table public.driver_memberships
    drop constraint if exists driver_memberships_status_check;

alter table public.driver_memberships
    add constraint driver_memberships_status_check
    check (status in ('active', 'expired', 'refunded', 'voided'))
    not valid;

alter table public.driver_memberships
    validate constraint driver_memberships_status_check;

comment on constraint driver_memberships_plan_check on public.driver_memberships is
    'Legacy vehicle names are accepted without plan_id; catalog-backed memberships use plan_id and plan codes.';

comment on constraint driver_memberships_status_check on public.driver_memberships is
    'Supports active, expired, refunded and audited voided memberships.';

commit;
