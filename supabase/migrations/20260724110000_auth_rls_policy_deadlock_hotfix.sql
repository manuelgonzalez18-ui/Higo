-- Persist the production hotfix that removes the profiles <-> rides RLS cycle.
--
-- Previous policy path:
-- profiles_ride_party_read -> rides_directed_offers_restrictive -> profiles
--
-- The two SECURITY DEFINER helpers below evaluate the current authenticated
-- driver and their offer without re-entering profiles/ride_offers RLS.

begin;

create or replace function public.higo_current_driver_has_active_offer(
    p_ride_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select public.higo_driver_has_active_offer(
        p_ride_id,
        auth.uid()
    );
$$;

revoke all on function public.higo_current_driver_has_active_offer(bigint)
from public, anon, authenticated;

grant execute on function public.higo_current_driver_has_active_offer(bigint)
to authenticated;

drop policy if exists rides_directed_offers_restrictive
on public.rides;

create policy rides_directed_offers_restrictive
on public.rides
as restrictive
for select
to authenticated
using (
    not public.higo_directed_offers_enabled()
    or not public.is_driver(auth.uid())
    or rides.status <> 'requested'
    or public.higo_current_driver_has_active_offer(rides.id)
);

commit;
