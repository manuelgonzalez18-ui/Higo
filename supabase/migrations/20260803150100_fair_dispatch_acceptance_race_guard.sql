-- Serialize wave expansion against ride acceptance/cancellation.

begin;

create or replace function public.higo_dispatch_wave(
    p_ride_id bigint,
    p_wave_number integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_config public.fair_dispatch_wave_config%rowtype;
    v_dispatch public.ride_dispatches%rowtype;
    v_count integer := 0;
begin
    select * into v_config
    from public.fair_dispatch_wave_config
    where wave_number = p_wave_number and enabled;

    if not found then
        return 0;
    end if;

    select * into v_dispatch
    from public.ride_dispatches
    where ride_id = p_ride_id
      and status = 'active'
    for update;

    if not found or v_dispatch.dispatch_deadline_at <= now() then
        return 0;
    end if;

    -- Acceptance updates the same rides row. Holding this lock until the wave
    -- insert commits prevents late offers from appearing after a driver wins.
    perform 1
    from public.rides r
    where r.id = p_ride_id
      and r.status = 'requested'
      and r.driver_id is null
    for update;

    if not found then
        return 0;
    end if;

    insert into public.ride_offers(
        ride_id,
        driver_id,
        distance_km,
        score,
        offered_at,
        expires_at,
        wave_number,
        rank_position,
        distance_score,
        wait_score,
        trip_deficit_score,
        offer_deficit_score,
        freshness_score,
        penalty_score,
        notification_status
    )
    select
        p_ride_id,
        ranked.driver_id,
        ranked.distance_km,
        ranked.score,
        now(),
        v_dispatch.dispatch_deadline_at,
        p_wave_number,
        ranked.rank_position,
        ranked.distance_score,
        ranked.wait_score,
        ranked.trip_deficit_score,
        ranked.offer_deficit_score,
        ranked.freshness_score,
        ranked.penalty_score,
        'pending'
    from (
        select
            candidates.*,
            (row_number() over (
                order by candidates.score desc, candidates.distance_km,
                         candidates.available_since, candidates.driver_id
            ))::integer as rank_position
        from public.higo_rank_dispatch_candidates(
            p_ride_id,
            v_config.radius_km,
            v_config.fairness_multiplier
        ) candidates
    ) ranked
    order by ranked.rank_position
    limit v_config.add_limit
    on conflict (ride_id, driver_id) do nothing;

    get diagnostics v_count = row_count;

    update public.ride_dispatches
    set current_wave = greatest(current_wave, p_wave_number),
        offers_created = offers_created + v_count,
        updated_at = now()
    where ride_id = p_ride_id;

    return v_count;
end;
$$;

revoke all on function public.higo_dispatch_wave(bigint,integer)
from public, anon, authenticated;
grant execute on function public.higo_dispatch_wave(bigint,integer)
to service_role;

commit;
