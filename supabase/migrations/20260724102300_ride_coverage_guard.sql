-- Fail-closed coverage enforcement for both hardened RPCs and legacy clients.
-- Passenger-created requests must contain coordinates and pass the canonical
-- is_within_coverage() check. Trusted service/admin repair sessions are exempt.

begin;

create or replace function public.higo_guard_ride_coverage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := auth.uid();
    v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
    v_is_admin boolean := false;
    v_is_database_repair boolean := session_user in ('postgres', 'supabase_admin');
    v_coverage boolean;
begin
    if coalesce(new.status, 'requested') <> 'requested' then
        return new;
    end if;

    if v_actor is not null then
        v_is_admin := public.higo_is_admin();
    end if;

    if v_is_service or v_is_admin or v_is_database_repair then
        return new;
    end if;

    if v_actor is null then
        raise exception 'authentication_required' using errcode = '42501';
    end if;
    if new.user_id is distinct from v_actor then
        raise exception 'ride_owner_mismatch' using errcode = '42501';
    end if;
    if new.pickup_lat is null or new.pickup_lng is null
       or new.dropoff_lat is null or new.dropoff_lng is null then
        raise exception 'ride_coordinates_required';
    end if;

    begin
        select public.is_within_coverage(
            new.pickup_lat::double precision,
            new.pickup_lng::double precision
        ) into v_coverage;
    exception
        when undefined_function then
            raise exception 'coverage_service_unavailable';
        when others then
            raise exception 'coverage_check_failed:%', sqlerrm;
    end;

    if not coalesce(v_coverage, false) then
        raise exception 'pickup_outside_coverage';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_higo_guard_ride_coverage on public.rides;
create trigger trg_higo_guard_ride_coverage
before insert on public.rides
for each row
execute function public.higo_guard_ride_coverage();

revoke all on function public.higo_guard_ride_coverage()
from public, anon, authenticated;

commit;
