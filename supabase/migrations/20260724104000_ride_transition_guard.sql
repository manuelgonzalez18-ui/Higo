-- Database-level ride transition guard.
-- Protects both the new RPC clients and older APKs that still update `rides`
-- directly. Service-role/admin repair operations remain possible.

begin;

create or replace function public.higo_log_ride_event(
    p_ride_id bigint,
    p_from_status text,
    p_to_status text,
    p_event_type text,
    p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- RPCs and the table trigger may observe the same transition. Keep a
    -- single event per actor/from/to in a short transaction window.
    if exists (
        select 1
        from public.ride_state_events e
        where e.ride_id = p_ride_id
          and e.actor_id is not distinct from auth.uid()
          and e.from_status is not distinct from p_from_status
          and e.to_status = p_to_status
          and e.created_at >= now() - interval '3 seconds'
    ) then
        return;
    end if;

    insert into public.ride_state_events(
        ride_id, actor_id, from_status, to_status, event_type, metadata
    ) values (
        p_ride_id,
        auth.uid(),
        p_from_status,
        p_to_status,
        p_event_type,
        coalesce(p_metadata, '{}'::jsonb)
    );
end;
$$;

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
    -- SQL Editor / trusted maintenance sessions do not carry auth.uid().
    -- session_user remains the original caller even inside SECURITY DEFINER.
    v_is_privileged_session boolean := session_user in ('postgres', 'supabase_admin');
    v_allowed boolean := false;
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

    -- Administrative, service-role and trusted SQL repair operations are still
    -- audited but are not constrained by the passenger/driver state graph.
    if v_is_service or v_is_admin or v_is_privileged_session then
        v_allowed := true;
    elsif old.status = 'requested' and new.status = 'accepted' then
        v_allowed := v_actor_role = 'driver'
            and new.driver_id = v_actor
            and old.driver_id is null;

        -- Compatibility protection for older APKs that still update rides
        -- directly instead of calling driver_accept_ride_v2(). The driver must
        -- satisfy the same archived/suspended/membership checks as the RPC.
        if v_allowed then
            perform public.higo_assert_driver_operational();
        end if;
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

create or replace function public.higo_audit_ride_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status is distinct from old.status then
        perform public.higo_log_ride_event(
            new.id,
            old.status,
            new.status,
            'ride.status_transition',
            jsonb_build_object(
                'driver_id', new.driver_id,
                'passenger_id', new.user_id,
                'source', 'table_trigger'
            )
        );
    end if;
    return new;
end;
$$;

drop trigger if exists trg_higo_guard_ride_transition on public.rides;
create trigger trg_higo_guard_ride_transition
before update of status on public.rides
for each row
execute function public.higo_guard_ride_transition();

drop trigger if exists trg_higo_audit_ride_transition on public.rides;
create trigger trg_higo_audit_ride_transition
after update of status on public.rides
for each row
execute function public.higo_audit_ride_transition();

revoke all on function public.higo_guard_ride_transition() from public, anon, authenticated;
revoke all on function public.higo_audit_ride_transition() from public, anon, authenticated;

commit;
