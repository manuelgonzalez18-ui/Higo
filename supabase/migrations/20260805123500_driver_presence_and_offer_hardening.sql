-- Native driver presence, chat readiness and directed-offer hardening.
-- Keeps web/native behavior on the same RPC path and prevents stale/mismatched
-- motorcycle offers from reaching the driver UI.

begin;

create or replace function public.driver_set_online_status(p_online boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_profile public.profiles%rowtype;
    v_withdrawn integer := 0;
begin
    if v_uid is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select * into v_profile
    from public.profiles
    where id = v_uid
    for update;

    if not found or coalesce(v_profile.role::text, '') <> 'driver' then
        raise exception 'driver account required' using errcode = '42501';
    end if;

    if coalesce(p_online, false) then
        perform public.higo_assert_driver_operational();
        update public.profiles
        set status = 'online'
        where id = v_uid;
    else
        update public.profiles
        set status = 'offline'
        where id = v_uid;

        update public.ride_offers
        set status = 'withdrawn',
            responded_at = coalesce(responded_at, now())
        where driver_id = v_uid
          and status = 'offered';
        get diagnostics v_withdrawn = row_count;
    end if;

    return jsonb_build_object(
        'driverId', v_uid,
        'online', coalesce(p_online, false),
        'status', case when coalesce(p_online, false) then 'online' else 'offline' end,
        'withdrawnOffers', v_withdrawn
    );
end;
$$;

create or replace function public.update_driver_gps(
    lat double precision,
    lng double precision,
    head double precision default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;
    if lat is null or lng is null or lat < -90 or lat > 90 or lng < -180 or lng > 180 then
        raise exception 'invalid driver coordinates' using errcode = '22023';
    end if;

    perform public.higo_assert_driver_operational();

    update public.profiles
    set curr_lat = lat,
        curr_lng = lng,
        heading = coalesce(head, heading),
        last_location_update = now(),
        status = 'online'
    where id = auth.uid()
      and role::text = 'driver';

    if not found then
        raise exception 'driver profile not found' using errcode = '42501';
    end if;
end;
$$;

create or replace function public.driver_list_ride_offers(
    p_limit integer default 20
)
returns table(
    offer_id bigint,
    expires_at timestamptz,
    distance_km numeric,
    score numeric,
    ride jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform public.higo_assert_driver_operational();

    -- Expire or withdraw anything that can no longer be presented. This also
    -- removes stale offers generated before a driver changed vehicle/status.
    update public.ride_offers o
    set status = case when o.expires_at <= now() then 'expired' else 'withdrawn' end,
        responded_at = coalesce(o.responded_at, now())
    from public.rides r
    join public.profiles p on p.id = auth.uid()
    where o.driver_id = auth.uid()
      and r.id = o.ride_id
      and o.status = 'offered'
      and (
          o.expires_at <= now()
          or r.status <> 'requested'
          or r.driver_id is not null
          or p.status <> 'online'
          or public.higo_canonical_vehicle_type(p.vehicle_type)
             is distinct from public.higo_canonical_vehicle_type(r.ride_type)
      );

    return query
    select
        o.id,
        o.expires_at,
        o.distance_km,
        o.score,
        to_jsonb(r)
    from public.ride_offers o
    join public.rides r on r.id = o.ride_id
    join public.profiles p on p.id = o.driver_id
    where o.driver_id = auth.uid()
      and o.status = 'offered'
      and o.expires_at > now()
      and r.status = 'requested'
      and r.driver_id is null
      and p.status = 'online'
      and public.higo_canonical_vehicle_type(p.vehicle_type)
          = public.higo_canonical_vehicle_type(r.ride_type)
    order by o.score desc, o.offered_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

revoke all on function public.driver_set_online_status(boolean) from public, anon;
grant execute on function public.driver_set_online_status(boolean) to authenticated;
revoke all on function public.update_driver_gps(double precision,double precision,double precision) from public, anon;
grant execute on function public.update_driver_gps(double precision,double precision,double precision) to authenticated;
revoke all on function public.driver_list_ride_offers(integer) from public, anon;
grant execute on function public.driver_list_ride_offers(integer) to authenticated;

commit;
