-- Tighten legacy direct acceptance after directed offers exist. SQL Editor
-- repair sessions remain possible through session_user, while SECURITY DEFINER
-- does not accidentally treat every caller as the function owner.

begin;

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
    v_has_directed_offers boolean := false;
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

        select exists(
            select 1
            from public.ride_offers o
            where o.ride_id = old.id
              and o.status = 'offered'
              and o.expires_at > now()
        ) into v_has_directed_offers;

        v_allowed := v_actor_role = 'driver'
            and new.driver_id = v_actor
            and old.driver_id is null
            and (
                not v_has_directed_offers
                or exists (
                    select 1
                    from public.ride_offers o
                    where o.ride_id = old.id
                      and o.driver_id = v_actor
                      and o.status = 'offered'
                      and o.expires_at > now()
                )
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

commit;
