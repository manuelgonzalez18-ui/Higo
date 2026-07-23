-- Directed offers require two explicit switches: the frontend build flag and
-- this database runtime flag. Applying migrations alone cannot change the
-- production dispatch behavior.

begin;

create table if not exists public.platform_runtime_flags (
    singleton boolean primary key default true check (singleton),
    directed_ride_offers boolean not null default false,
    updated_at timestamptz not null default now(),
    updated_by uuid
);

insert into public.platform_runtime_flags(singleton, directed_ride_offers)
values (true, false)
on conflict (singleton) do nothing;

alter table public.platform_runtime_flags enable row level security;

drop policy if exists platform_runtime_flags_admin_read on public.platform_runtime_flags;
create policy platform_runtime_flags_admin_read
on public.platform_runtime_flags for select
using (public.higo_is_admin());

revoke insert, update, delete on public.platform_runtime_flags from anon, authenticated;
grant select on public.platform_runtime_flags to authenticated;

create or replace function public.higo_directed_offers_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((
        select directed_ride_offers
        from public.platform_runtime_flags
        where singleton
    ), false);
$$;

create or replace function public.higo_has_active_ride_offers(p_ride_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists(
        select 1
        from public.ride_offers o
        where o.ride_id = p_ride_id
          and o.status = 'offered'
          and o.expires_at > now()
    );
$$;

create or replace function public.higo_driver_has_active_offer(
    p_ride_id bigint,
    p_driver_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists(
        select 1
        from public.ride_offers o
        where o.ride_id = p_ride_id
          and o.driver_id = p_driver_id
          and o.status = 'offered'
          and o.expires_at > now()
    );
$$;

revoke all on function public.higo_has_active_ride_offers(bigint)
from public, anon, authenticated;
revoke all on function public.higo_driver_has_active_offer(bigint,uuid)
from public, anon, authenticated;

grant execute on function public.higo_directed_offers_enabled() to authenticated;

create or replace function public.admin_set_platform_runtime_flags(
    p_directed_ride_offers boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_before jsonb;
    v_after jsonb;
begin
    perform public.higo_assert_admin('manage_operations', true);

    select to_jsonb(f) into v_before
    from public.platform_runtime_flags f
    where singleton
    for update;

    update public.platform_runtime_flags
    set directed_ride_offers = coalesce(p_directed_ride_offers, false),
        updated_at = now(),
        updated_by = auth.uid()
    where singleton
    returning to_jsonb(platform_runtime_flags.*) into v_after;

    insert into public.admin_audit_log(
        actor_id, action, entity_type, entity_id,
        before_data, after_data, reason
    ) values (
        auth.uid(),
        'platform.runtime_flags',
        'platform_runtime_flags',
        'singleton',
        v_before,
        v_after,
        'Cambio explícito de banderas operativas.'
    );

    return v_after;
end;
$$;

grant execute on function public.admin_set_platform_runtime_flags(boolean)
to authenticated;

-- Dispatch only when the database switch is on.
create or replace function public.higo_dispatch_new_ride()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status = 'requested' and public.higo_directed_offers_enabled() then
        perform public.higo_dispatch_ride(new.id, 20, 30);
    end if;
    return new;
end;
$$;

-- Older and newer clients are both guarded, but offer ownership is required
-- only after the runtime switch is explicitly enabled.
create or replace function public.higo_guard_ride_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := auth.uid();
    v_actor_role text;
    v_is_admin boolean := false;
    v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
    v_is_database_repair boolean := session_user in ('postgres', 'supabase_admin');
    v_allowed boolean := false;
    v_directed boolean := public.higo_directed_offers_enabled();
begin
    if new.status is not distinct from old.status then
        return new;
    end if;

    if v_actor is not null then
        select p.role into v_actor_role
        from public.profiles p
        where p.id = v_actor;
        v_is_admin := public.higo_is_admin();
    end if;

    if v_is_service or v_is_admin or v_is_database_repair then
        v_allowed := true;
    elsif old.status = 'requested' and new.status = 'accepted' then
        perform public.higo_assert_driver_operational();
        v_allowed := v_actor_role = 'driver'
            and new.driver_id = v_actor
            and old.driver_id is null
            and (
                not v_directed
                or not public.higo_has_active_ride_offers(old.id)
                or public.higo_driver_has_active_offer(old.id, v_actor)
            );
    elsif old.status in ('requested', 'accepted') and new.status = 'cancelled' then
        v_allowed := old.user_id = v_actor;
    elsif old.status = 'accepted' and new.status = 'in_progress' then
        v_allowed := old.driver_id = v_actor and new.driver_id = v_actor;
    elsif old.status = 'in_progress' and new.status = 'arrived_at_dropoff' then
        v_allowed := old.driver_id = v_actor and new.driver_id = v_actor;
    elsif old.status in ('in_progress', 'arrived_at_dropoff') and new.status = 'completed' then
        v_allowed := old.driver_id = v_actor and new.driver_id = v_actor;
    end if;

    if not v_allowed then
        raise exception 'invalid_ride_transition:%->%', old.status, new.status
            using errcode = '42501';
    end if;

    if new.status = 'accepted' then
        new.accepted_at := coalesce(new.accepted_at, now());
    elsif new.status = 'in_progress' then
        new.started_at := coalesce(new.started_at, now());
    elsif new.status = 'arrived_at_dropoff' then
        new.arrived_at_dropoff_at := coalesce(new.arrived_at_dropoff_at, now());
    elsif new.status = 'completed' then
        new.completed_at := coalesce(new.completed_at, now());
    elsif new.status = 'cancelled' then
        new.cancelled_at := coalesce(new.cancelled_at, now());
        if old.user_id = v_actor and coalesce(trim(new.cancellation_reason), '') = '' then
            raise exception 'cancellation_reason_required';
        end if;
    end if;

    return new;
end;
$$;

-- Realtime and direct SELECTs are narrowed only while directed dispatch is on.
-- Drivers without a matching offer cannot see a requested ride; passengers,
-- assigned parties and admins retain their existing visibility.
drop policy if exists rides_directed_offers_restrictive on public.rides;
create policy rides_directed_offers_restrictive
on public.rides
as restrictive
for select
to authenticated
using (
    not public.higo_directed_offers_enabled()
    or not exists(
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'driver'
    )
    or rides.status <> 'requested'
    or not public.higo_has_active_ride_offers(rides.id)
    or public.higo_driver_has_active_offer(rides.id, auth.uid())
);

commit;
