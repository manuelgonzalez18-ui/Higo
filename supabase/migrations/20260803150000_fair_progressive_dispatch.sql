-- Fair progressive dispatch for Higo.
--
-- The rollout is additive and OFF by default. Existing directed dispatch keeps
-- its current behaviour until fair_progressive_dispatch is enabled explicitly.
-- A separate shadow flag records the ranking without changing who receives the
-- request, so the weights can be validated with production traffic first.

begin;

alter table public.platform_runtime_flags
    add column if not exists fair_progressive_dispatch boolean not null default false,
    add column if not exists fair_dispatch_shadow boolean not null default false;

alter table public.ride_offers
    add column if not exists wave_number integer,
    add column if not exists rank_position integer,
    add column if not exists distance_score numeric(10,4),
    add column if not exists wait_score numeric(10,4),
    add column if not exists trip_deficit_score numeric(10,4),
    add column if not exists offer_deficit_score numeric(10,4),
    add column if not exists freshness_score numeric(10,4),
    add column if not exists penalty_score numeric(10,4),
    add column if not exists notification_status text not null default 'pending',
    add column if not exists notification_sent_at timestamptz,
    add column if not exists notification_error text;

alter table public.ride_offers
    drop constraint if exists ride_offers_notification_status_check;
alter table public.ride_offers
    add constraint ride_offers_notification_status_check
    check (notification_status in ('pending','sent','failed','skipped'));

create index if not exists idx_ride_offers_recent_driver
    on public.ride_offers(driver_id, offered_at desc);
create index if not exists idx_rides_driver_recent_completed
    on public.rides(driver_id, completed_at desc)
    where status = 'completed';
create index if not exists idx_rides_driver_active
    on public.rides(driver_id, status)
    where status in ('accepted','in_progress','arrived_at_dropoff');

create table if not exists public.fair_dispatch_wave_config (
    wave_number integer primary key,
    delay_seconds integer not null check (delay_seconds >= 0),
    add_limit integer not null check (add_limit > 0),
    radius_km numeric(8,2) not null check (radius_km > 0),
    fairness_multiplier numeric(6,3) not null check (fairness_multiplier >= 0),
    enabled boolean not null default true,
    updated_at timestamptz not null default now()
);

insert into public.fair_dispatch_wave_config(
    wave_number, delay_seconds, add_limit, radius_km, fairness_multiplier
) values
    (1,  0,   3,  3.0, 1.00),
    (2, 10,   5,  5.0, 0.85),
    (3, 20,  10,  8.0, 0.60),
    (4, 35, 500, 10.0, 0.25)
on conflict (wave_number) do update
set delay_seconds = excluded.delay_seconds,
    add_limit = excluded.add_limit,
    radius_km = excluded.radius_km,
    fairness_multiplier = excluded.fairness_multiplier,
    updated_at = now();

alter table public.fair_dispatch_wave_config enable row level security;
drop policy if exists fair_dispatch_wave_config_admin_read
    on public.fair_dispatch_wave_config;
create policy fair_dispatch_wave_config_admin_read
on public.fair_dispatch_wave_config for select
using (public.higo_is_admin());
revoke insert, update, delete on public.fair_dispatch_wave_config from anon, authenticated;
grant select on public.fair_dispatch_wave_config to authenticated;

create table if not exists public.driver_dispatch_state (
    driver_id uuid primary key references public.profiles(id) on delete cascade,
    is_online boolean not null default false,
    available_since timestamptz,
    last_completed_ride_at timestamptz,
    updated_at timestamptz not null default now()
);

alter table public.driver_dispatch_state enable row level security;
drop policy if exists driver_dispatch_state_self_admin_read
    on public.driver_dispatch_state;
create policy driver_dispatch_state_self_admin_read
on public.driver_dispatch_state for select
using (driver_id = auth.uid() or public.higo_is_admin());
revoke insert, update, delete on public.driver_dispatch_state from anon, authenticated;
grant select on public.driver_dispatch_state to authenticated;

insert into public.driver_dispatch_state(
    driver_id, is_online, available_since, last_completed_ride_at
)
select
    p.id,
    p.status = 'online',
    case when p.status = 'online'
        then coalesce(p.last_location_update, p.updated_at, now())
        else null
    end,
    (
        select max(coalesce(r.completed_at, r.created_at))
        from public.rides r
        where r.driver_id = p.id and r.status = 'completed'
    )
from public.profiles p
where p.role = 'driver'
on conflict (driver_id) do nothing;

create table if not exists public.ride_dispatches (
    ride_id bigint primary key references public.rides(id) on delete cascade,
    status text not null default 'active'
        check (status in ('active','accepted','cancelled','completed','expired','exhausted')),
    current_wave integer not null default 0,
    started_at timestamptz not null default now(),
    next_wave_at timestamptz,
    dispatch_deadline_at timestamptz not null default now() + interval '3 minutes',
    completed_at timestamptz,
    offers_created integer not null default 0,
    updated_at timestamptz not null default now()
);

create index if not exists idx_ride_dispatches_due
    on public.ride_dispatches(next_wave_at)
    where status = 'active';

alter table public.ride_dispatches enable row level security;
drop policy if exists ride_dispatches_admin_read on public.ride_dispatches;
create policy ride_dispatches_admin_read
on public.ride_dispatches for select
using (public.higo_is_admin());
revoke insert, update, delete on public.ride_dispatches from anon, authenticated;
grant select on public.ride_dispatches to authenticated;

create table if not exists public.fair_dispatch_shadow_candidates (
    ride_id bigint not null references public.rides(id) on delete cascade,
    driver_id uuid not null references public.profiles(id) on delete cascade,
    predicted_wave integer not null,
    rank_position integer not null,
    distance_km numeric(10,3) not null,
    score numeric(12,4) not null,
    distance_score numeric(10,4) not null,
    wait_score numeric(10,4) not null,
    trip_deficit_score numeric(10,4) not null,
    offer_deficit_score numeric(10,4) not null,
    freshness_score numeric(10,4) not null,
    penalty_score numeric(10,4) not null,
    completed_rides_7d integer not null,
    offers_received_24h integer not null,
    computed_at timestamptz not null default now(),
    primary key (ride_id, driver_id)
);

create index if not exists idx_fair_dispatch_shadow_ride_rank
    on public.fair_dispatch_shadow_candidates(ride_id, predicted_wave, rank_position);

alter table public.fair_dispatch_shadow_candidates enable row level security;
drop policy if exists fair_dispatch_shadow_admin_read
    on public.fair_dispatch_shadow_candidates;
create policy fair_dispatch_shadow_admin_read
on public.fair_dispatch_shadow_candidates for select
using (public.higo_is_admin());
revoke insert, update, delete on public.fair_dispatch_shadow_candidates from anon, authenticated;
grant select on public.fair_dispatch_shadow_candidates to authenticated;

create or replace function public.higo_fair_progressive_dispatch_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((
        select directed_ride_offers and fair_progressive_dispatch
        from public.platform_runtime_flags
        where singleton
    ), false);
$$;

create or replace function public.higo_fair_dispatch_shadow_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((
        select fair_dispatch_shadow
        from public.platform_runtime_flags
        where singleton
    ), false);
$$;

grant execute on function public.higo_fair_progressive_dispatch_enabled() to authenticated;
grant execute on function public.higo_fair_dispatch_shadow_enabled() to authenticated;

create or replace function public.higo_sync_driver_dispatch_presence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.role <> 'driver' then
        return new;
    end if;

    insert into public.driver_dispatch_state(
        driver_id, is_online, available_since, updated_at
    ) values (
        new.id,
        new.status = 'online',
        case when new.status = 'online' then now() else null end,
        now()
    )
    on conflict (driver_id) do update
    set is_online = excluded.is_online,
        available_since = case
            when excluded.is_online and not driver_dispatch_state.is_online then now()
            when excluded.is_online then coalesce(driver_dispatch_state.available_since, now())
            else null
        end,
        updated_at = now();

    return new;
end;
$$;

drop trigger if exists trg_higo_sync_driver_dispatch_presence on public.profiles;
create trigger trg_higo_sync_driver_dispatch_presence
after insert or update of status on public.profiles
for each row
execute function public.higo_sync_driver_dispatch_presence();

create or replace function public.higo_sync_driver_dispatch_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status = 'completed'
       and old.status is distinct from new.status
       and new.driver_id is not null then
        insert into public.driver_dispatch_state(
            driver_id, is_online, available_since, last_completed_ride_at, updated_at
        )
        select
            new.driver_id,
            p.status = 'online',
            case when p.status = 'online' then now() else null end,
            coalesce(new.completed_at, now()),
            now()
        from public.profiles p
        where p.id = new.driver_id
        on conflict (driver_id) do update
        set is_online = excluded.is_online,
            available_since = excluded.available_since,
            last_completed_ride_at = excluded.last_completed_ride_at,
            updated_at = now();
    end if;

    return new;
end;
$$;

drop trigger if exists trg_higo_sync_driver_dispatch_completion on public.rides;
create trigger trg_higo_sync_driver_dispatch_completion
after update of status on public.rides
for each row
execute function public.higo_sync_driver_dispatch_completion();

create or replace function public.higo_rank_dispatch_candidates(
    p_ride_id bigint,
    p_radius_km numeric,
    p_fairness_multiplier numeric default 1
)
returns table(
    driver_id uuid,
    distance_km numeric,
    score numeric,
    distance_score numeric,
    wait_score numeric,
    trip_deficit_score numeric,
    offer_deficit_score numeric,
    freshness_score numeric,
    penalty_score numeric,
    available_since timestamptz,
    completed_rides_7d integer,
    offers_received_24h integer
)
language sql
stable
security definer
set search_path = public
as $$
with target_ride as (
    select r.*
    from public.rides r
    where r.id = p_ride_id
      and r.status = 'requested'
      and r.driver_id is null
),
base as (
    select
        p.id as driver_id,
        public.higo_haversine_km(
            p.curr_lat::double precision,
            p.curr_lng::double precision,
            r.pickup_lat::double precision,
            r.pickup_lng::double precision
        )::numeric as distance_km,
        extract(epoch from (now() - coalesce(p.last_location_update, p.updated_at))) / 60
            as location_age_minutes,
        coalesce(ds.available_since, p.last_location_update, p.updated_at, now())
            as available_since
    from target_ride r
    join public.profiles p on true
    left join public.driver_dispatch_state ds on ds.driver_id = p.id
    where p.role = 'driver'
      and p.status = 'online'
      and p.archived_at is null
      and p.suspended_at is null
      and p.curr_lat is not null
      and p.curr_lng is not null
      and coalesce(p.last_location_update, p.updated_at) >= now() - interval '3 minutes'
      and public.higo_canonical_vehicle_type(p.vehicle_type)
          = public.higo_canonical_vehicle_type(r.ride_type)
      and public.higo_haversine_km(
            p.curr_lat::double precision,
            p.curr_lng::double precision,
            r.pickup_lat::double precision,
            r.pickup_lng::double precision
          ) <= greatest(0.5, least(coalesce(p_radius_km, 10), 30))
      and not exists (
          select 1
          from public.rides active_ride
          where active_ride.driver_id = p.id
            and active_ride.status in ('accepted','in_progress','arrived_at_dropoff')
      )
      and not exists (
          select 1
          from public.ride_offers previous_offer
          where previous_offer.ride_id = r.id
            and previous_offer.driver_id = p.id
      )
      and (
          exists (
              select 1
              from public.driver_memberships dm
              where dm.driver_id = p.id
                and dm.voided_at is null
                and dm.status = 'active'
                and dm.expires_at >= now()
          )
          or (
              p.subscription_override_until is not null
              and p.subscription_override_until >= now()
          )
      )
),
metrics as (
    select
        b.*,
        coalesce(ride_stats.completed_7d, 0)::integer as completed_7d,
        coalesce(offer_stats.offers_24h, 0)::integer as offers_24h,
        coalesce(offer_stats.ignored_2h, 0)::integer as ignored_2h,
        coalesce(offer_stats.ignored_30m, 0)::integer as ignored_30m
    from base b
    left join lateral (
        select count(*) filter (
            where coalesce(r.completed_at, r.created_at) >= now() - interval '7 days'
        ) as completed_7d
        from public.rides r
        where r.driver_id = b.driver_id
          and r.status = 'completed'
          and coalesce(r.completed_at, r.created_at) >= now() - interval '7 days'
    ) ride_stats on true
    left join lateral (
        select
            count(*) filter (where o.offered_at >= now() - interval '24 hours') as offers_24h,
            count(*) filter (
                where o.offered_at >= now() - interval '2 hours'
                  and o.status = 'expired'
            ) as ignored_2h,
            count(*) filter (
                where o.offered_at >= now() - interval '30 minutes'
                  and o.status = 'expired'
            ) as ignored_30m
        from public.ride_offers o
        where o.driver_id = b.driver_id
          and o.offered_at >= now() - interval '24 hours'
    ) offer_stats on true
),
eligible as (
    select *
    from metrics
    where ignored_30m < 5
),
bounds as (
    select
        e.*,
        greatest(max(e.completed_7d) over (), 1) as max_completed_7d,
        greatest(max(e.offers_24h) over (), 1) as max_offers_24h
    from eligible e
),
components as (
    select
        b.*,
        greatest(0, 40 * (1 - least(b.distance_km, p_radius_km) / greatest(p_radius_km, 0.5)))
            as c_distance,
        least(30, greatest(0,
            extract(epoch from (now() - b.available_since)) / 60 / 120 * 30
        )) as c_wait,
        greatest(0, 15 * (1 - b.completed_7d::numeric / b.max_completed_7d::numeric))
            as c_trip,
        greatest(0, 10 * (1 - b.offers_24h::numeric / b.max_offers_24h::numeric))
            as c_offer,
        greatest(0, 5 * (1 - least(b.location_age_minutes, 3) / 3))
            as c_fresh,
        least(10, b.ignored_2h * 2)::numeric as c_penalty
    from bounds b
)
select
    c.driver_id,
    round(c.distance_km, 3),
    round((
        c.c_distance
        + greatest(0, coalesce(p_fairness_multiplier, 1))
            * (c.c_wait + c.c_trip + c.c_offer)
        + c.c_fresh
        - c.c_penalty
    )::numeric, 4) as score,
    round(c.c_distance::numeric, 4),
    round(c.c_wait::numeric, 4),
    round(c.c_trip::numeric, 4),
    round(c.c_offer::numeric, 4),
    round(c.c_fresh::numeric, 4),
    round(c.c_penalty::numeric, 4),
    c.available_since,
    c.completed_7d,
    c.offers_24h
from components c
order by score desc, c.distance_km, c.available_since, c.driver_id;
$$;

revoke all on function public.higo_rank_dispatch_candidates(bigint,numeric,numeric)
from public, anon, authenticated;
grant execute on function public.higo_rank_dispatch_candidates(bigint,numeric,numeric)
to service_role;

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
            row_number() over (
                order by candidates.score desc, candidates.distance_km,
                         candidates.available_since, candidates.driver_id
            )::integer as rank_position
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

create or replace function public.higo_capture_fair_dispatch_shadow(p_ride_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer := 0;
begin
    delete from public.fair_dispatch_shadow_candidates where ride_id = p_ride_id;

    insert into public.fair_dispatch_shadow_candidates(
        ride_id,
        driver_id,
        predicted_wave,
        rank_position,
        distance_km,
        score,
        distance_score,
        wait_score,
        trip_deficit_score,
        offer_deficit_score,
        freshness_score,
        penalty_score,
        completed_rides_7d,
        offers_received_24h
    )
    select
        p_ride_id,
        ranked.driver_id,
        case
            when ranked.distance_km <= 3 and ranked.rank_position <= 3 then 1
            when ranked.distance_km <= 5 and ranked.rank_position <= 8 then 2
            when ranked.distance_km <= 8 and ranked.rank_position <= 18 then 3
            else 4
        end,
        ranked.rank_position,
        ranked.distance_km,
        ranked.score,
        ranked.distance_score,
        ranked.wait_score,
        ranked.trip_deficit_score,
        ranked.offer_deficit_score,
        ranked.freshness_score,
        ranked.penalty_score,
        ranked.completed_rides_7d,
        ranked.offers_received_24h
    from (
        select
            candidates.*,
            row_number() over (
                order by candidates.score desc, candidates.distance_km,
                         candidates.available_since, candidates.driver_id
            )::integer as rank_position
        from public.higo_rank_dispatch_candidates(p_ride_id, 10, 1) candidates
    ) ranked;

    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

revoke all on function public.higo_capture_fair_dispatch_shadow(bigint)
from public, anon, authenticated;
grant execute on function public.higo_capture_fair_dispatch_shadow(bigint)
to service_role;

create or replace function public.higo_start_progressive_dispatch(p_ride_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_created integer := 0;
    v_first_limit integer;
    v_next_delay integer;
begin
    insert into public.ride_dispatches(
        ride_id, status, current_wave, started_at, next_wave_at,
        dispatch_deadline_at, offers_created, updated_at
    )
    select
        r.id, 'active', 0, now(), now(),
        now() + interval '3 minutes', 0, now()
    from public.rides r
    where r.id = p_ride_id
      and r.status = 'requested'
      and r.driver_id is null
    on conflict (ride_id) do update
    set status = case
            when public.ride_dispatches.status in ('accepted','cancelled','completed')
                then public.ride_dispatches.status
            else 'active'
        end,
        updated_at = now();

    if not found then
        return 0;
    end if;

    v_created := public.higo_dispatch_wave(p_ride_id, 1);

    select add_limit into v_first_limit
    from public.fair_dispatch_wave_config
    where wave_number = 1 and enabled;

    select delay_seconds into v_next_delay
    from public.fair_dispatch_wave_config
    where wave_number = 2 and enabled;

    update public.ride_dispatches
    set next_wave_at = case
            when v_next_delay is null then null
            when v_created < coalesce(v_first_limit, 1) then now()
            else started_at + make_interval(secs => v_next_delay)
        end,
        status = case when v_next_delay is null then 'exhausted' else status end,
        updated_at = now()
    where ride_id = p_ride_id and status = 'active';

    return v_created;
end;
$$;

revoke all on function public.higo_start_progressive_dispatch(bigint)
from public, anon, authenticated;
grant execute on function public.higo_start_progressive_dispatch(bigint)
to service_role;

create or replace function public.higo_expand_due_dispatches(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    dispatch_row public.ride_dispatches%rowtype;
    v_next_wave integer;
    v_created integer;
    v_wave_limit integer;
    v_following_delay integer;
    v_processed integer := 0;
begin
    update public.ride_offers
    set status = 'expired',
        responded_at = coalesce(responded_at, now()),
        notification_status = case
            when notification_status = 'pending' then 'skipped'
            else notification_status
        end
    where status = 'offered'
      and expires_at <= now();

    update public.ride_dispatches d
    set status = case
            when r.status = 'cancelled' then 'cancelled'
            when r.status = 'completed' then 'completed'
            when r.status <> 'requested' or r.driver_id is not null then 'accepted'
            else 'expired'
        end,
        next_wave_at = null,
        completed_at = coalesce(d.completed_at, now()),
        updated_at = now()
    from public.rides r
    where d.ride_id = r.id
      and d.status = 'active'
      and (
          r.status <> 'requested'
          or r.driver_id is not null
          or d.dispatch_deadline_at <= now()
      );

    if not public.higo_fair_progressive_dispatch_enabled() then
        return 0;
    end if;

    for dispatch_row in
        select d.*
        from public.ride_dispatches d
        join public.rides r on r.id = d.ride_id
        where d.status = 'active'
          and d.next_wave_at is not null
          and d.next_wave_at <= now()
          and d.dispatch_deadline_at > now()
          and r.status = 'requested'
          and r.driver_id is null
        order by d.next_wave_at, d.ride_id
        for update of d skip locked
        limit greatest(1, least(coalesce(p_limit, 50), 200))
    loop
        v_next_wave := dispatch_row.current_wave + 1;

        select add_limit into v_wave_limit
        from public.fair_dispatch_wave_config
        where wave_number = v_next_wave and enabled;

        if v_wave_limit is null then
            update public.ride_dispatches
            set status = 'exhausted', next_wave_at = null, updated_at = now()
            where ride_id = dispatch_row.ride_id;
            continue;
        end if;

        v_created := public.higo_dispatch_wave(dispatch_row.ride_id, v_next_wave);

        select delay_seconds into v_following_delay
        from public.fair_dispatch_wave_config
        where wave_number = v_next_wave + 1 and enabled;

        update public.ride_dispatches
        set next_wave_at = case
                when v_following_delay is null then null
                when v_created < v_wave_limit then now()
                else started_at + make_interval(secs => v_following_delay)
            end,
            status = case when v_following_delay is null then 'exhausted' else 'active' end,
            updated_at = now()
        where ride_id = dispatch_row.ride_id
          and status = 'active';

        v_processed := v_processed + 1;
    end loop;

    return v_processed;
end;
$$;

revoke all on function public.higo_expand_due_dispatches(integer)
from public, anon, authenticated;
grant execute on function public.higo_expand_due_dispatches(integer)
to service_role;

create or replace function public.higo_sync_progressive_dispatch_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status = 'accepted' and new.driver_id is not null then
        update public.ride_dispatches
        set status = 'accepted', next_wave_at = null,
            completed_at = coalesce(completed_at, now()), updated_at = now()
        where ride_id = new.id and status = 'active';
    elsif new.status = 'cancelled' then
        update public.ride_dispatches
        set status = 'cancelled', next_wave_at = null,
            completed_at = coalesce(completed_at, now()), updated_at = now()
        where ride_id = new.id and status in ('active','exhausted');
    elsif new.status = 'completed' then
        update public.ride_dispatches
        set status = 'completed', next_wave_at = null,
            completed_at = coalesce(completed_at, now()), updated_at = now()
        where ride_id = new.id;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_higo_sync_progressive_dispatch_state on public.rides;
create trigger trg_higo_sync_progressive_dispatch_state
after update of status, driver_id on public.rides
for each row
execute function public.higo_sync_progressive_dispatch_state();

create or replace function public.higo_dispatch_new_ride()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status <> 'requested' then
        return new;
    end if;

    if public.higo_fair_dispatch_shadow_enabled() then
        perform public.higo_capture_fair_dispatch_shadow(new.id);
    end if;

    if public.higo_fair_progressive_dispatch_enabled() then
        perform public.higo_start_progressive_dispatch(new.id);
    elsif public.higo_directed_offers_enabled() then
        perform public.higo_dispatch_ride(new.id, 20, 30);
    end if;

    return new;
end;
$$;

create or replace function public.admin_set_fair_dispatch_flags(
    p_progressive_enabled boolean,
    p_shadow_enabled boolean
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
    set fair_progressive_dispatch = coalesce(p_progressive_enabled, false),
        fair_dispatch_shadow = coalesce(p_shadow_enabled, false),
        updated_at = now(),
        updated_by = auth.uid()
    where singleton
    returning to_jsonb(platform_runtime_flags.*) into v_after;

    insert into public.admin_audit_log(
        actor_id, action, entity_type, entity_id,
        before_data, after_data, reason
    ) values (
        auth.uid(),
        'platform.fair_dispatch_flags',
        'platform_runtime_flags',
        'singleton',
        v_before,
        v_after,
        'Cambio explícito del rollout de despacho equitativo.'
    );

    return v_after;
end;
$$;

grant execute on function public.admin_set_fair_dispatch_flags(boolean,boolean)
to authenticated;

create or replace function public.admin_fair_dispatch_metrics(p_hours integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_hours integer := greatest(1, least(coalesce(p_hours, 24), 720));
    v_result jsonb;
begin
    perform public.higo_assert_admin('view_analytics', true);

    with recent_dispatches as (
        select d.*
        from public.ride_dispatches d
        where d.started_at >= now() - make_interval(hours => v_hours)
    ),
    acceptance as (
        select
            count(*) as dispatches,
            count(*) filter (where d.status in ('accepted','completed')) as accepted,
            avg(extract(epoch from (coalesce(r.accepted_at, d.completed_at) - d.started_at)))
                filter (where d.status in ('accepted','completed')) as avg_accept_seconds,
            percentile_cont(0.9) within group (
                order by extract(epoch from (coalesce(r.accepted_at, d.completed_at) - d.started_at))
            ) filter (where d.status in ('accepted','completed')) as p90_accept_seconds,
            avg(d.offers_created) as avg_offers
        from recent_dispatches d
        join public.rides r on r.id = d.ride_id
    ),
    waves as (
        select coalesce(jsonb_object_agg(wave_number::text, accepted_count), '{}'::jsonb) as data
        from (
            select o.wave_number, count(*) as accepted_count
            from public.ride_offers o
            join recent_dispatches d on d.ride_id = o.ride_id
            where o.status = 'accepted'
            group by o.wave_number
        ) grouped
    ),
    fairness as (
        select
            count(*) as drivers_offered,
            min(driver_offer_count) as min_offers_per_driver,
            max(driver_offer_count) as max_offers_per_driver,
            avg(driver_offer_count) as avg_offers_per_driver
        from (
            select o.driver_id, count(*)::numeric as driver_offer_count
            from public.ride_offers o
            where o.offered_at >= now() - make_interval(hours => v_hours)
            group by o.driver_id
        ) per_driver
    )
    select jsonb_build_object(
        'windowHours', v_hours,
        'dispatches', coalesce(a.dispatches, 0),
        'accepted', coalesce(a.accepted, 0),
        'acceptRate', case when coalesce(a.dispatches, 0) = 0 then 0
            else round(a.accepted::numeric / a.dispatches::numeric, 4) end,
        'avgAcceptSeconds', round(coalesce(a.avg_accept_seconds, 0)::numeric, 2),
        'p90AcceptSeconds', round(coalesce(a.p90_accept_seconds, 0)::numeric, 2),
        'avgOffersPerDispatch', round(coalesce(a.avg_offers, 0)::numeric, 2),
        'acceptedByWave', w.data,
        'driversOffered', coalesce(f.drivers_offered, 0),
        'minOffersPerDriver', coalesce(f.min_offers_per_driver, 0),
        'maxOffersPerDriver', coalesce(f.max_offers_per_driver, 0),
        'avgOffersPerDriver', round(coalesce(f.avg_offers_per_driver, 0)::numeric, 2)
    ) into v_result
    from acceptance a cross join waves w cross join fairness f;

    return v_result;
end;
$$;

grant execute on function public.admin_fair_dispatch_metrics(integer)
to authenticated;

-- Supabase Cron/pg_cron supports second-based schedules. The job is harmless
-- while the rollout flag is off because higo_expand_due_dispatches exits early.
do $cron_setup$
declare
    v_job_id bigint;
begin
    execute $sql$
        select cron.unschedule(jobid)
        from cron.job
        where jobname = 'higo-expand-progressive-dispatch'
    $sql$;

    execute $sql$
        select cron.schedule(
            'higo-expand-progressive-dispatch',
            '5 seconds',
            'select public.higo_expand_due_dispatches(50);'
        )
    $sql$ into v_job_id;
exception
    when insufficient_privilege or undefined_table or undefined_function or invalid_schema_name then
        raise notice 'pg_cron unavailable; enable Supabase Cron and schedule higo_expand_due_dispatches(50) every 5 seconds.';
end;
$cron_setup$;

commit;
