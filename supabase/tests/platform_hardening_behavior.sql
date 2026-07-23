-- Transactional behavior tests for the platform hardening.
-- The fixed users and rides are rolled back at the end.

begin;

-- Test identities.
insert into public.profiles(
    id, full_name, role, status, vehicle_type, vehicle_model,
    subscription_status, created_at, updated_at
) values
    ('00000000-0000-4000-8000-000000000101', 'CI Passenger', 'passenger', 'offline', null, null, 'suspended', now(), now()),
    ('00000000-0000-4000-8000-000000000102', 'CI Driver Without Membership', 'driver', 'online', 'standard', 'CI Car', 'suspended', now(), now()),
    ('00000000-0000-4000-8000-000000000103', 'CI Driver Active', 'driver', 'online', 'standard', 'CI Car', 'active', now(), now())
on conflict (id) do update set
    role = excluded.role,
    status = excluded.status,
    vehicle_type = excluded.vehicle_type,
    vehicle_model = excluded.vehicle_model,
    subscription_status = excluded.subscription_status,
    suspended_at = null,
    archived_at = null;

insert into public.driver_memberships(
    driver_id, plan_id, plan, amount, currency, period,
    paid_at, expires_at, status, payment_method, payment_reference, source
)
select
    '00000000-0000-4000-8000-000000000103'::uuid,
    p.id,
    p.code,
    p.amount,
    p.currency,
    p.period,
    now(),
    now() + interval '7 days',
    'active',
    'ci',
    'CI-ACTIVE-DRIVER',
    'ci'
from public.driver_membership_plans p
where p.code = 'car-weekly'
  and not exists (
      select 1
      from public.driver_memberships dm
      where dm.payment_reference = 'CI-ACTIVE-DRIVER'
  );

-- Exercise the compatibility triggers with the same table privileges an older
-- authenticated client would use. These grants are transaction-scoped because
-- the whole file is rolled back.
grant select, insert, update on public.rides to authenticated;

-- ---------------------------------------------------------------------------
-- Passenger context
-- ---------------------------------------------------------------------------
set session authorization authenticator;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', false);
select set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated"}',
    false
);

-- Direct legacy inserts outside coverage must fail closed.
do $$
begin
    begin
        insert into public.rides(
            id, user_id, pickup, dropoff, price, ride_type, status,
            pickup_lat, pickup_lng, dropoff_lat, dropoff_lng
        ) values (
            900000001,
            '00000000-0000-4000-8000-000000000101',
            'Outside coverage',
            'Outside coverage destination',
            2.00,
            'standard',
            'requested',
            0, 0, 0.01, 0.01
        );
        raise exception 'behavior_assertion_failed:outside_coverage_direct_insert_allowed';
    exception
        when others then
            if sqlerrm not like '%pickup_outside_coverage%' then
                raise;
            end if;
    end;
end;
$$;

-- The hardened RPC must reject the same out-of-zone origin.
do $$
begin
    begin
        perform public.create_ride_request_v4(
            '00000000-0000-4000-8000-000000001001',
            'Outside coverage',
            'Outside coverage destination',
            0, 0, 0.01, 0.01,
            'standard', 'ride', null, '[]'::jsonb,
            null, null, null, null, null, null, 2.00
        );
        raise exception 'behavior_assertion_failed:outside_coverage_rpc_allowed';
    exception
        when others then
            if sqlerrm not like '%pickup_outside_coverage%' then
                raise;
            end if;
    end;
end;
$$;

-- A repeated client_request_id must return the original ride and create only
-- one row. The stored price must never be below the passenger-visible floor.
do $$
declare
    v_first jsonb;
    v_second jsonb;
    v_ride_id bigint;
    v_count bigint;
    v_price numeric;
begin
    v_first := public.create_ride_request_v4(
        '00000000-0000-4000-8000-000000001002',
        'Higuerote center',
        'Nearby destination',
        10.4653, -65.9711, 10.4750, -65.9800,
        'standard', 'ride', 2.0, '[]'::jsonb,
        null, null, null, null, null, null, 3.25
    );

    v_second := public.create_ride_request_v4(
        '00000000-0000-4000-8000-000000001002',
        'Higuerote center',
        'Nearby destination',
        10.4653, -65.9711, 10.4750, -65.9800,
        'standard', 'ride', 2.0, '[]'::jsonb,
        null, null, null, null, null, null, 3.25
    );

    if v_first->>'rideId' is distinct from v_second->>'rideId' then
        raise exception 'behavior_assertion_failed:idempotent_ride_id_changed';
    end if;
    if coalesce((v_second->>'idempotentReplay')::boolean, false) is not true then
        raise exception 'behavior_assertion_failed:idempotent_replay_not_reported';
    end if;

    v_ride_id := (v_first->>'rideId')::bigint;
    select count(*), max(price)
    into v_count, v_price
    from public.rides
    where user_id = '00000000-0000-4000-8000-000000000101'
      and client_request_id = '00000000-0000-4000-8000-000000001002';

    if v_count <> 1 then
        raise exception 'behavior_assertion_failed:idempotency_created_%_rides', v_count;
    end if;
    if v_price < 3.25 then
        raise exception 'behavior_assertion_failed:client_subtotal_floor_lowered:%', v_price;
    end if;
end;
$$;

-- Create a second requested ride for the legacy direct-update guard test.
select public.create_ride_request_v4(
    '00000000-0000-4000-8000-000000001003',
    'Higuerote center',
    'Second nearby destination',
    10.4653, -65.9711, 10.4700, -65.9760,
    'standard', 'ride', 1.5, '[]'::jsonb,
    null, null, null, null, null, null, 2.50
);

reset role;
reset session authorization;

-- ---------------------------------------------------------------------------
-- Driver without membership
-- ---------------------------------------------------------------------------
set session authorization authenticator;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000102', false);
select set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated"}',
    false
);

-- New RPC path must reject acceptance without an active membership.
do $$
declare
    v_ride_id bigint;
begin
    select id into v_ride_id
    from public.rides
    where client_request_id = '00000000-0000-4000-8000-000000001002';

    begin
        perform public.driver_accept_ride_v2(v_ride_id);
        raise exception 'behavior_assertion_failed:rpc_accept_without_membership_allowed';
    exception
        when others then
            if sqlerrm not like '%membership_required%' then
                raise;
            end if;
    end;
end;
$$;

-- Older APKs updating rides directly must hit the same membership guard.
do $$
declare
    v_ride_id bigint;
begin
    select id into v_ride_id
    from public.rides
    where client_request_id = '00000000-0000-4000-8000-000000001003';

    begin
        update public.rides
        set status = 'accepted',
            driver_id = '00000000-0000-4000-8000-000000000102'
        where id = v_ride_id;
        raise exception 'behavior_assertion_failed:legacy_accept_without_membership_allowed';
    exception
        when others then
            if sqlerrm not like '%membership_required%' then
                raise;
            end if;
    end;
end;
$$;

reset role;
reset session authorization;

-- ---------------------------------------------------------------------------
-- Active driver
-- ---------------------------------------------------------------------------
set session authorization authenticator;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000103', false);
select set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated"}',
    false
);

do $$
declare
    v_ride_id bigint;
    v_result jsonb;
    v_status text;
    v_driver_id uuid;
begin
    select id into v_ride_id
    from public.rides
    where client_request_id = '00000000-0000-4000-8000-000000001002';

    v_result := public.driver_accept_ride_v2(v_ride_id);

    select status, driver_id
    into v_status, v_driver_id
    from public.rides
    where id = v_ride_id;

    if v_status <> 'accepted'
       or v_driver_id <> '00000000-0000-4000-8000-000000000103'::uuid then
        raise exception 'behavior_assertion_failed:active_driver_accept_failed';
    end if;

    -- Completing an accepted ride before starting it must remain impossible.
    begin
        perform public.driver_complete_ride_v2(v_ride_id);
        raise exception 'behavior_assertion_failed:completed_before_start_allowed';
    exception
        when others then
            if sqlerrm like '%behavior_assertion_failed:%' then
                raise;
            end if;
    end;

    select status into v_status from public.rides where id = v_ride_id;
    if v_status <> 'accepted' then
        raise exception 'behavior_assertion_failed:invalid_completion_changed_status:%', v_status;
    end if;
end;
$$;

reset role;
reset session authorization;

rollback;

select 'platform_hardening_behavior' as test_suite, true as passed;
