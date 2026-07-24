-- Higo platform hardening
-- 1) Unifies driver membership checkout on driver_membership_plans.
-- 2) Adds idempotent, server-priced ride creation with transactional promos.
-- 3) Adds audited server-side ride state transitions.
--
-- Rollout note: the new RPCs coexist with legacy client writes until the
-- application smoke tests pass in staging. A later enforcement migration can
-- revoke direct writes without interrupting the current production clients.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Canonical membership + payment metadata
-- ---------------------------------------------------------------------------

alter table public.payment_reports
    add column if not exists membership_plan_id uuid,
    add column if not exists membership_plan_code text;

alter table public.driver_memberships
    add column if not exists payment_report_id text,
    add column if not exists source text not null default 'admin';

create or replace function public.higo_canonical_vehicle_type(p_value text)
returns text
language sql
immutable
as $$
    select case lower(trim(coalesce(p_value, '')))
        when 'moto' then 'moto'
        when 'motorcycle' then 'moto'
        when 'motocicleta' then 'moto'
        when 'van' then 'van'
        when 'camioneta' then 'van'
        when 'pickup' then 'van'
        when 'car' then 'standard'
        when 'carro' then 'standard'
        when 'auto' then 'standard'
        when 'standard' then 'standard'
        else 'standard'
    end;
$$;

create or replace function public.driver_membership_checkout()
returns table(
    id uuid,
    code text,
    name text,
    vehicle_type text,
    period text,
    duration_days integer,
    amount numeric,
    currency text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_vehicle_type text;
begin
    select public.higo_canonical_vehicle_type(
        coalesce(nullif(p.vehicle_type, ''), nullif(p.vehicle_model, ''), 'standard')
    )
    into v_vehicle_type
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'driver';

    if v_vehicle_type is null then
        raise exception 'driver_profile_required' using errcode = '42501';
    end if;

    return query
    select
        mp.id,
        mp.code,
        mp.name,
        public.higo_canonical_vehicle_type(mp.vehicle_type),
        mp.period,
        mp.duration_days,
        mp.amount,
        mp.currency
    from public.driver_membership_plans mp
    where mp.active
      and public.higo_canonical_vehicle_type(mp.vehicle_type) = v_vehicle_type
    order by mp.duration_days, mp.amount;
end;
$$;

grant execute on function public.driver_membership_checkout() to authenticated;

create or replace function public.register_membership_payment_v2(
    p_driver_id uuid,
    p_plan_id uuid,
    p_payment_type text,
    p_bank_origin text,
    p_reference text,
    p_sender_phone text,
    p_amount_reported numeric,
    p_amount_real numeric,
    p_trn_date date,
    p_banesco_status text,
    p_raw_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_plan public.driver_membership_plans%rowtype;
    v_vehicle_type text;
    v_report_id text;
    v_membership_id bigint;
    v_start timestamptz;
    v_expires timestamptz;
begin
    select * into v_plan
    from public.driver_membership_plans
    where id = p_plan_id
      and active
    for share;

    if not found then
        raise exception 'membership_plan_not_found';
    end if;

    select public.higo_canonical_vehicle_type(
        coalesce(nullif(p.vehicle_type, ''), nullif(p.vehicle_model, ''), 'standard')
    )
    into v_vehicle_type
    from public.profiles p
    where p.id = p_driver_id
      and p.role = 'driver'
      and p.archived_at is null
    for update;

    if v_vehicle_type is null then
        raise exception 'driver_not_found_or_archived';
    end if;

    if public.higo_canonical_vehicle_type(v_plan.vehicle_type) <> v_vehicle_type then
        raise exception 'membership_plan_vehicle_mismatch';
    end if;

    if coalesce(trim(p_reference), '') = '' then
        raise exception 'payment_reference_required';
    end if;

    begin
        insert into public.payment_reports(
            driver_id,
            payment_type,
            bank_origin,
            reference_last6,
            sender_phone,
            amount_reported,
            amount_real,
            trn_date,
            banesco_status,
            status,
            raw_response,
            membership_plan_id,
            membership_plan_code
        ) values (
            p_driver_id,
            p_payment_type,
            p_bank_origin,
            trim(p_reference),
            nullif(trim(p_sender_phone), ''),
            p_amount_reported,
            p_amount_real,
            p_trn_date,
            p_banesco_status,
            'validated',
            coalesce(p_raw_response, '{}'::jsonb),
            v_plan.id,
            v_plan.code
        )
        returning id::text into v_report_id;
    exception
        when unique_violation then
            raise exception 'payment_reference_already_used' using errcode = '23505';
    end;

    select greatest(
        now(),
        coalesce(max(dm.expires_at) filter (
            where dm.voided_at is null
              and dm.status = 'active'
              and dm.expires_at > now()
        ), now())
    )
    into v_start
    from public.driver_memberships dm
    where dm.driver_id = p_driver_id;

    v_expires := v_start + make_interval(days => v_plan.duration_days);

    insert into public.driver_memberships(
        driver_id,
        plan_id,
        plan,
        amount,
        currency,
        period,
        paid_at,
        expires_at,
        status,
        payment_method,
        payment_reference,
        payment_report_id,
        source,
        created_by
    ) values (
        p_driver_id,
        v_plan.id,
        v_plan.code,
        v_plan.amount,
        v_plan.currency,
        v_plan.period,
        now(),
        v_expires,
        'active',
        p_payment_type,
        trim(p_reference),
        v_report_id,
        'banesco',
        p_driver_id
    )
    returning id into v_membership_id;

    update public.profiles
    set subscription_status = 'active',
        last_payment_date = now(),
        suspended_at = null,
        suspension_reason = null
    where id = p_driver_id;

    if to_regclass('public.admin_audit_log') is not null then
        insert into public.admin_audit_log(
            actor_id, action, entity_type, entity_id, after_data, metadata
        ) values (
            p_driver_id,
            'membership.payment_validated',
            'driver_membership',
            v_membership_id::text,
            jsonb_build_object(
                'driver_id', p_driver_id,
                'plan_id', v_plan.id,
                'plan_code', v_plan.code,
                'expires_at', v_expires,
                'payment_report_id', v_report_id
            ),
            jsonb_build_object('source', 'banesco')
        );
    end if;

    return jsonb_build_object(
        'membership_id', v_membership_id,
        'report_id', v_report_id,
        'plan_id', v_plan.id,
        'plan_code', v_plan.code,
        'expires_at', v_expires
    );
end;
$$;

revoke all on function public.register_membership_payment_v2(
    uuid, uuid, text, text, text, text, numeric, numeric, date, text, jsonb
) from public, anon, authenticated;
grant execute on function public.register_membership_payment_v2(
    uuid, uuid, text, text, text, text, numeric, numeric, date, text, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- Server-side pricing, idempotent ride creation and transactional promos
-- ---------------------------------------------------------------------------

alter table public.rides
    add column if not exists client_request_id uuid,
    add column if not exists quoted_distance_km numeric(12,3),
    add column if not exists price_before_discount numeric(12,2),
    add column if not exists discount_amount numeric(12,2) not null default 0,
    add column if not exists pricing_snapshot jsonb,
    add column if not exists promo_code_id bigint,
    add column if not exists stops jsonb not null default '[]'::jsonb,
    add column if not exists accepted_at timestamptz,
    add column if not exists arrived_at_pickup_at timestamptz,
    add column if not exists started_at timestamptz,
    add column if not exists completed_at timestamptz,
    add column if not exists cancelled_at timestamptz;

create unique index if not exists uq_rides_user_client_request
    on public.rides(user_id, client_request_id)
    where client_request_id is not null;

create table if not exists public.promo_redemptions (
    id uuid primary key default gen_random_uuid(),
    promo_id bigint not null references public.promo_codes(id) on delete restrict,
    ride_id bigint not null references public.rides(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete restrict,
    discount_amount numeric(12,2) not null check (discount_amount >= 0),
    created_at timestamptz not null default now(),
    unique (ride_id)
);
create index if not exists idx_promo_redemptions_user_promo
    on public.promo_redemptions(user_id, promo_id, created_at desc);

alter table public.promo_redemptions enable row level security;
drop policy if exists promo_redemptions_admin_read on public.promo_redemptions;
create policy promo_redemptions_admin_read
on public.promo_redemptions for select
using (public.higo_is_admin());

grant select on public.promo_redemptions to authenticated;
revoke insert, update, delete on public.promo_redemptions from anon, authenticated;

create or replace function public.higo_haversine_km(
    p_lat1 double precision,
    p_lng1 double precision,
    p_lat2 double precision,
    p_lng2 double precision
)
returns numeric
language sql
immutable
as $$
    select (
        6371.0 * 2.0 * asin(
            least(1.0, sqrt(
                power(sin(radians(p_lat2 - p_lat1) / 2.0), 2) +
                cos(radians(p_lat1)) * cos(radians(p_lat2)) *
                power(sin(radians(p_lng2 - p_lng1) / 2.0), 2)
            ))
        )
    )::numeric;
$$;

create or replace function public.higo_quote_ride_v2(
    p_pickup_lat double precision,
    p_pickup_lng double precision,
    p_dropoff_lat double precision,
    p_dropoff_lng double precision,
    p_vehicle_type text,
    p_service_type text default 'ride',
    p_route_distance_km numeric default null,
    p_stops_count integer default 0,
    p_promo_code text default null,
    p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_type text := public.higo_canonical_vehicle_type(p_vehicle_type);
    v_base numeric := 0;
    v_per_km numeric := 0;
    v_delivery_fee numeric := 0;
    v_stop_fee numeric := 0;
    v_haversine numeric;
    v_distance numeric;
    v_surge numeric := 1;
    v_subtotal numeric;
    v_discount numeric := 0;
    v_final numeric;
    v_promo record;
    v_promo_valid boolean := false;
    v_promo_error text := null;
    v_user_uses bigint := 0;
    v_stops integer := greatest(0, least(coalesce(p_stops_count, 0), 5));
begin
    if p_pickup_lat is null or p_pickup_lng is null
       or p_dropoff_lat is null or p_dropoff_lng is null then
        raise exception 'ride_coordinates_required';
    end if;

    select
        pc.base,
        pc.per_km,
        pc.delivery_fee,
        pc.stop_fee
    into v_base, v_per_km, v_delivery_fee, v_stop_fee
    from public.pricing_config pc
    where public.higo_canonical_vehicle_type(pc.vehicle_type) = v_type
    limit 1;

    if v_base is null then
        if v_type = 'moto' then
            v_base := 1.00; v_per_km := 0.25; v_delivery_fee := 0.50; v_stop_fee := 0.50;
        elsif v_type = 'van' then
            v_base := 1.70; v_per_km := 0.60; v_delivery_fee := 2.00; v_stop_fee := 1.00;
        else
            v_base := 1.50; v_per_km := 0.40; v_delivery_fee := 1.50; v_stop_fee := 1.00;
        end if;
    end if;

    v_haversine := public.higo_haversine_km(
        p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng
    );

    -- The client route distance may improve accuracy, but it can never lower
    -- the server-computed straight-line minimum. Extreme values are capped.
    v_distance := greatest(
        v_haversine,
        least(
            coalesce(p_route_distance_km, v_haversine),
            greatest(v_haversine * 4, v_haversine + 5)
        )
    );

    begin
        execute 'select public.get_active_pricing_multiplier($1,$2,$3)'
        into v_surge
        using v_type, p_pickup_lat, p_pickup_lng;
    exception
        when undefined_function then v_surge := 1;
        when others then v_surge := 1;
    end;
    v_surge := greatest(1, least(coalesce(v_surge, 1), 5));

    v_subtotal := (
        v_base +
        greatest(0, v_distance - 1) * v_per_km +
        v_stops * coalesce(v_stop_fee, 0) +
        case when coalesce(p_service_type, 'ride') = 'delivery'
             then coalesce(v_delivery_fee, 0) else 0 end
    ) * v_surge;
    v_subtotal := round(greatest(v_base, v_subtotal), 2);

    if coalesce(trim(p_promo_code), '') <> '' then
        select
            pc.id, pc.code, pc.discount_type, pc.discount_value,
            pc.min_ride_amount, pc.expires_at, pc.max_uses,
            pc.max_uses_per_user, pc.used_count, pc.active,
            pc.archived_at, pc.budget_amount, pc.spent_amount
        into v_promo
        from public.promo_codes pc
        where upper(pc.code) = upper(trim(p_promo_code))
        limit 1;

        if not found or not coalesce(v_promo.active, false) or v_promo.archived_at is not null then
            v_promo_error := 'inactive';
        elsif v_promo.expires_at is not null and v_promo.expires_at < now() then
            v_promo_error := 'expired';
        elsif v_subtotal < coalesce(v_promo.min_ride_amount, 0) then
            v_promo_error := 'minimum_not_met';
        elsif v_promo.max_uses is not null and coalesce(v_promo.used_count, 0) >= v_promo.max_uses then
            v_promo_error := 'usage_limit_reached';
        else
            if p_user_id is not null and v_promo.max_uses_per_user is not null then
                select count(*) into v_user_uses
                from public.promo_redemptions pr
                where pr.promo_id = v_promo.id
                  and pr.user_id = p_user_id;
            end if;

            if v_promo.max_uses_per_user is not null and v_user_uses >= v_promo.max_uses_per_user then
                v_promo_error := 'user_limit_reached';
            else
                v_discount := case
                    when v_promo.discount_type = 'percent'
                        then v_subtotal * coalesce(v_promo.discount_value, 0) / 100
                    else least(coalesce(v_promo.discount_value, 0), v_subtotal)
                end;
                v_discount := round(greatest(0, least(v_discount, v_subtotal)), 2);

                if v_promo.budget_amount is not null
                   and coalesce(v_promo.spent_amount, 0) + v_discount > v_promo.budget_amount then
                    v_discount := 0;
                    v_promo_error := 'budget_exhausted';
                else
                    v_promo_valid := true;
                end if;
            end if;
        end if;
    end if;

    v_final := round(greatest(0, v_subtotal - v_discount), 2);

    return jsonb_build_object(
        'vehicleType', v_type,
        'serviceType', coalesce(p_service_type, 'ride'),
        'distanceKm', round(v_distance, 3),
        'haversineKm', round(v_haversine, 3),
        'stopsCount', v_stops,
        'base', v_base,
        'perKm', v_per_km,
        'deliveryFee', case when p_service_type = 'delivery' then v_delivery_fee else 0 end,
        'stopFee', v_stop_fee,
        'surgeMultiplier', v_surge,
        'subtotal', v_subtotal,
        'discount', v_discount,
        'finalPrice', v_final,
        'promoId', case when v_promo_valid then v_promo.id else null end,
        'promoCode', case when v_promo_valid then v_promo.code else null end,
        'promoValid', v_promo_valid,
        'promoError', v_promo_error,
        'generatedAt', now()
    );
end;
$$;

grant execute on function public.higo_quote_ride_v2(
    double precision, double precision, double precision, double precision,
    text, text, numeric, integer, text, uuid
) to authenticated;

create or replace function public.create_ride_request_v2(
    p_client_request_id uuid,
    p_pickup text,
    p_dropoff text,
    p_pickup_lat double precision,
    p_pickup_lng double precision,
    p_dropoff_lat double precision,
    p_dropoff_lng double precision,
    p_vehicle_type text,
    p_service_type text default 'ride',
    p_route_distance_km numeric default null,
    p_stops jsonb default '[]'::jsonb,
    p_promo_code text default null,
    p_passenger_phone text default null,
    p_delivery_info jsonb default null,
    p_payer text default null,
    p_cod_amount numeric default null,
    p_terms_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_role text;
    v_quote jsonb;
    v_ride_id bigint;
    v_existing jsonb;
    v_promo_id bigint;
    v_promo record;
    v_discount numeric := 0;
    v_stops_count integer := 0;
    v_coverage boolean := true;
begin
    if v_user_id is null then
        raise exception 'authentication_required' using errcode = '42501';
    end if;
    if p_client_request_id is null then
        raise exception 'client_request_id_required';
    end if;

    select p.role into v_role
    from public.profiles p
    where p.id = v_user_id;
    if coalesce(v_role, 'passenger') not in ('passenger', 'user') then
        raise exception 'passenger_role_required' using errcode = '42501';
    end if;

    select jsonb_build_object(
        'rideId', r.id,
        'price', r.price,
        'status', r.status,
        'idempotentReplay', true
    )
    into v_existing
    from public.rides r
    where r.user_id = v_user_id
      and r.client_request_id = p_client_request_id;
    if v_existing is not null then
        return v_existing;
    end if;

    begin
        execute 'select public.is_within_coverage($1,$2)'
        into v_coverage
        using p_pickup_lat, p_pickup_lng;
    exception
        when undefined_function then v_coverage := true;
        when others then v_coverage := true;
    end;
    if not coalesce(v_coverage, false) then
        raise exception 'pickup_outside_coverage';
    end if;

    if jsonb_typeof(coalesce(p_stops, '[]'::jsonb)) = 'array' then
        v_stops_count := jsonb_array_length(coalesce(p_stops, '[]'::jsonb));
    end if;

    -- Lock the promo row before quoting so max-use and budget checks remain
    -- valid until redemption is recorded in this transaction.
    if coalesce(trim(p_promo_code), '') <> '' then
        select * into v_promo
        from public.promo_codes pc
        where upper(pc.code) = upper(trim(p_promo_code))
        for update;
    end if;

    v_quote := public.higo_quote_ride_v2(
        p_pickup_lat,
        p_pickup_lng,
        p_dropoff_lat,
        p_dropoff_lng,
        p_vehicle_type,
        p_service_type,
        p_route_distance_km,
        v_stops_count,
        p_promo_code,
        v_user_id
    );

    if coalesce(trim(p_promo_code), '') <> ''
       and not coalesce((v_quote->>'promoValid')::boolean, false) then
        raise exception 'promo_invalid:%', coalesce(v_quote->>'promoError', 'unknown');
    end if;

    v_promo_id := nullif(v_quote->>'promoId', '')::bigint;
    v_discount := coalesce((v_quote->>'discount')::numeric, 0);

    insert into public.rides(
        user_id,
        pickup,
        dropoff,
        price,
        ride_type,
        status,
        payment_method,
        passenger_phone,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        service_type,
        delivery_info,
        payer,
        cod_amount,
        cod_currency,
        client_request_id,
        quoted_distance_km,
        price_before_discount,
        discount_amount,
        pricing_snapshot,
        promo_code_id,
        stops
    ) values (
        v_user_id,
        trim(p_pickup),
        trim(p_dropoff),
        (v_quote->>'finalPrice')::numeric,
        public.higo_canonical_vehicle_type(p_vehicle_type),
        'requested',
        'direct',
        nullif(trim(p_passenger_phone), ''),
        p_pickup_lat,
        p_pickup_lng,
        p_dropoff_lat,
        p_dropoff_lng,
        coalesce(nullif(trim(p_service_type), ''), 'ride'),
        p_delivery_info,
        p_payer,
        p_cod_amount,
        case when coalesce(p_cod_amount, 0) > 0 then 'USD' else null end,
        p_client_request_id,
        (v_quote->>'distanceKm')::numeric,
        (v_quote->>'subtotal')::numeric,
        v_discount,
        v_quote,
        v_promo_id,
        coalesce(p_stops, '[]'::jsonb)
    )
    returning id into v_ride_id;

    if v_promo_id is not null then
        insert into public.promo_redemptions(
            promo_id, ride_id, user_id, discount_amount
        ) values (
            v_promo_id, v_ride_id, v_user_id, v_discount
        );

        update public.promo_codes
        set used_count = coalesce(used_count, 0) + 1,
            spent_amount = coalesce(spent_amount, 0) + v_discount
        where id = v_promo_id;
    end if;

    if coalesce(p_service_type, 'ride') = 'delivery'
       and coalesce(trim(p_terms_version), '') <> ''
       and to_regclass('public.terms_acceptances') is not null then
        insert into public.terms_acceptances(
            user_id, terms_kind, terms_version, accepted_at, ride_id
        ) values (
            v_user_id, 'delivery', trim(p_terms_version), now(), v_ride_id
        );
    end if;

    return jsonb_build_object(
        'rideId', v_ride_id,
        'price', (v_quote->>'finalPrice')::numeric,
        'quote', v_quote,
        'status', 'requested',
        'idempotentReplay', false
    );
exception
    when unique_violation then
        select jsonb_build_object(
            'rideId', r.id,
            'price', r.price,
            'status', r.status,
            'idempotentReplay', true
        )
        into v_existing
        from public.rides r
        where r.user_id = v_user_id
          and r.client_request_id = p_client_request_id;
        if v_existing is not null then
            return v_existing;
        end if;
        raise;
end;
$$;

grant execute on function public.create_ride_request_v2(
    uuid, text, text, double precision, double precision,
    double precision, double precision, text, text, numeric, jsonb,
    text, text, jsonb, text, numeric, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Audited ride state machine
-- ---------------------------------------------------------------------------

create table if not exists public.ride_state_events (
    id bigint generated by default as identity primary key,
    ride_id bigint not null references public.rides(id) on delete cascade,
    actor_id uuid,
    from_status text,
    to_status text not null,
    event_type text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists idx_ride_state_events_ride_created
    on public.ride_state_events(ride_id, created_at desc);

alter table public.ride_state_events enable row level security;
drop policy if exists ride_state_events_parties_read on public.ride_state_events;
create policy ride_state_events_parties_read
on public.ride_state_events for select
using (
    public.higo_is_admin()
    or exists (
        select 1 from public.rides r
        where r.id = ride_state_events.ride_id
          and (r.user_id = auth.uid() or r.driver_id = auth.uid())
    )
);

grant select on public.ride_state_events to authenticated;
revoke insert, update, delete on public.ride_state_events from anon, authenticated;

create or replace function public.higo_log_ride_event(
    p_ride_id bigint,
    p_from_status text,
    p_to_status text,
    p_event_type text,
    p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
    insert into public.ride_state_events(
        ride_id, actor_id, from_status, to_status, event_type, metadata
    ) values (
        p_ride_id, auth.uid(), p_from_status, p_to_status,
        p_event_type, coalesce(p_metadata, '{}'::jsonb)
    );
$$;

revoke all on function public.higo_log_ride_event(bigint,text,text,text,jsonb)
from public, anon, authenticated;

create or replace function public.higo_assert_driver_operational()
returns public.profiles
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_profile public.profiles%rowtype;
    v_has_membership boolean := false;
begin
    select * into v_profile
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'driver';

    if not found then
        raise exception 'driver_role_required' using errcode = '42501';
    end if;
    if v_profile.archived_at is not null then
        raise exception 'driver_archived' using errcode = '42501';
    end if;
    if v_profile.suspended_at is not null then
        raise exception 'driver_suspended' using errcode = '42501';
    end if;

    select exists(
        select 1
        from public.driver_memberships dm
        where dm.driver_id = auth.uid()
          and dm.voided_at is null
          and dm.status = 'active'
          and dm.expires_at >= now()
    )
    into v_has_membership;

    if not v_has_membership
       and not (v_profile.subscription_override_until is not null
                and v_profile.subscription_override_until >= now()) then
        raise exception 'membership_required' using errcode = '42501';
    end if;

    return v_profile;
end;
$$;

create or replace function public.driver_accept_ride_v2(p_ride_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_profile public.profiles%rowtype;
    v_ride jsonb;
begin
    v_profile := public.higo_assert_driver_operational();

    update public.rides r
    set driver_id = v_profile.id,
        status = 'accepted',
        accepted_at = coalesce(r.accepted_at, now())
    where r.id = p_ride_id
      and r.status = 'requested'
      and r.driver_id is null
    returning to_jsonb(r) into v_ride;

    if v_ride is null then
        select to_jsonb(r) into v_ride
        from public.rides r
        where r.id = p_ride_id
          and r.driver_id = v_profile.id
          and r.status in ('accepted','in_progress','arrived_at_dropoff');
        if v_ride is null then
            raise exception 'ride_unavailable';
        end if;
        return v_ride;
    end if;

    perform public.higo_log_ride_event(
        p_ride_id, 'requested', 'accepted', 'driver.accept', '{}'::jsonb
    );
    return v_ride;
end;
$$;

create or replace function public.driver_mark_arrival_v2(p_ride_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ride jsonb;
begin
    perform public.higo_assert_driver_operational();
    update public.rides r
    set arrived_at_pickup_at = coalesce(r.arrived_at_pickup_at, now())
    where r.id = p_ride_id
      and r.driver_id = auth.uid()
      and r.status = 'accepted'
    returning to_jsonb(r) into v_ride;

    if v_ride is null then
        select to_jsonb(r) into v_ride from public.rides r
        where r.id = p_ride_id and r.driver_id = auth.uid();
        if v_ride is null then raise exception 'ride_not_assigned'; end if;
    else
        perform public.higo_log_ride_event(
            p_ride_id, 'accepted', 'accepted', 'driver.arrived_pickup', '{}'::jsonb
        );
    end if;
    return v_ride;
end;
$$;

create or replace function public.driver_start_ride_v2(p_ride_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ride public.rides%rowtype;
    v_wait_seconds integer := 0;
    v_wait_rate numeric := 0;
    v_wait_fee numeric := 0;
    v_result jsonb;
begin
    perform public.higo_assert_driver_operational();

    select * into v_ride
    from public.rides r
    where r.id = p_ride_id
      and r.driver_id = auth.uid()
    for update;

    if not found then raise exception 'ride_not_assigned'; end if;
    if v_ride.status in ('in_progress','arrived_at_dropoff','completed') then
        return to_jsonb(v_ride);
    end if;
    if v_ride.status <> 'accepted' then raise exception 'invalid_ride_transition'; end if;

    if v_ride.arrived_at_pickup_at is not null then
        v_wait_seconds := greatest(0, floor(extract(epoch from now() - v_ride.arrived_at_pickup_at))::integer);
    end if;

    select pc.wait_per_min into v_wait_rate
    from public.pricing_config pc
    where public.higo_canonical_vehicle_type(pc.vehicle_type)
          = public.higo_canonical_vehicle_type(v_ride.ride_type)
    limit 1;
    if v_wait_rate is null then
        v_wait_rate := case public.higo_canonical_vehicle_type(v_ride.ride_type)
            when 'moto' then 0.05 when 'van' then 0.10 else 0.08 end;
    end if;
    v_wait_fee := round(greatest(0, v_wait_seconds::numeric / 60 - 3) * v_wait_rate, 2);

    update public.rides r
    set status = 'in_progress',
        started_at = coalesce(r.started_at, now()),
        wait_seconds = v_wait_seconds,
        wait_fee = v_wait_fee,
        price = round(coalesce(r.price, 0) + v_wait_fee, 2)
    where r.id = p_ride_id
    returning to_jsonb(r) into v_result;

    perform public.higo_log_ride_event(
        p_ride_id, 'accepted', 'in_progress', 'driver.start',
        jsonb_build_object('wait_seconds', v_wait_seconds, 'wait_fee', v_wait_fee)
    );
    return v_result;
end;
$$;

create or replace function public.driver_mark_dropoff_arrival_v2(p_ride_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_result jsonb;
begin
    perform public.higo_assert_driver_operational();
    update public.rides r
    set status = 'arrived_at_dropoff',
        arrived_at_dropoff_at = coalesce(r.arrived_at_dropoff_at, now())
    where r.id = p_ride_id
      and r.driver_id = auth.uid()
      and r.status = 'in_progress'
    returning to_jsonb(r) into v_result;

    if v_result is null then
        select to_jsonb(r) into v_result from public.rides r
        where r.id = p_ride_id and r.driver_id = auth.uid()
          and r.status in ('arrived_at_dropoff','completed');
        if v_result is null then raise exception 'invalid_ride_transition'; end if;
        return v_result;
    end if;

    perform public.higo_log_ride_event(
        p_ride_id, 'in_progress', 'arrived_at_dropoff', 'driver.arrived_dropoff', '{}'::jsonb
    );
    return v_result;
end;
$$;

create or replace function public.driver_complete_ride_v2(p_ride_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ride public.rides%rowtype;
    v_result jsonb;
    v_is_delivery boolean;
begin
    perform public.higo_assert_driver_operational();
    select * into v_ride
    from public.rides r
    where r.id = p_ride_id
      and r.driver_id = auth.uid()
    for update;

    if not found then raise exception 'ride_not_assigned'; end if;
    if v_ride.status = 'completed' then return to_jsonb(v_ride); end if;
    if v_ride.status not in ('in_progress','arrived_at_dropoff') then
        raise exception 'invalid_ride_transition';
    end if;

    v_is_delivery := v_ride.service_type = 'delivery' or v_ride.delivery_info is not null;
    if v_is_delivery and v_ride.delivery_pod_url is null then
        raise exception 'delivery_pod_required';
    end if;
    if v_is_delivery and coalesce(v_ride.cod_amount, 0) > 0
       and not coalesce(v_ride.cod_collected, false) then
        raise exception 'cod_confirmation_required';
    end if;

    update public.rides r
    set status = 'completed',
        completed_at = coalesce(r.completed_at, now())
    where r.id = p_ride_id
    returning to_jsonb(r) into v_result;

    perform public.higo_log_ride_event(
        p_ride_id, v_ride.status, 'completed', 'driver.complete', '{}'::jsonb
    );
    return v_result;
end;
$$;

create or replace function public.ride_confirm_payment_v2(p_ride_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ride public.rides%rowtype;
    v_role text;
    v_updates jsonb := '{}'::jsonb;
    v_result jsonb;
begin
    select * into v_ride from public.rides r where r.id = p_ride_id for update;
    if not found then raise exception 'ride_not_found'; end if;

    select p.role into v_role from public.profiles p where p.id = auth.uid();
    if auth.uid() = v_ride.driver_id and v_role = 'driver' then
        update public.rides r
        set payment_confirmed_by_driver = true,
            payment_confirmed_at = case when r.payment_confirmed_by_user then coalesce(r.payment_confirmed_at, now()) else r.payment_confirmed_at end
        where r.id = p_ride_id
        returning to_jsonb(r) into v_result;
        v_updates := jsonb_build_object('actor', 'driver');
    elsif auth.uid() = v_ride.user_id then
        update public.rides r
        set payment_confirmed_by_user = true,
            payment_confirmed_at = case when r.payment_confirmed_by_driver then coalesce(r.payment_confirmed_at, now()) else r.payment_confirmed_at end
        where r.id = p_ride_id
        returning to_jsonb(r) into v_result;
        v_updates := jsonb_build_object('actor', 'passenger');
    else
        raise exception 'ride_party_required' using errcode = '42501';
    end if;

    perform public.higo_log_ride_event(
        p_ride_id, v_ride.status, v_ride.status, 'payment.confirm', v_updates
    );
    return v_result;
end;
$$;

create or replace function public.passenger_cancel_ride_v2(
    p_ride_id bigint,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_from text;
    v_result jsonb;
begin
    if coalesce(trim(p_reason), '') = '' then raise exception 'cancellation_reason_required'; end if;

    select r.status into v_from
    from public.rides r
    where r.id = p_ride_id
      and r.user_id = auth.uid()
    for update;

    if v_from is null then raise exception 'ride_not_found'; end if;
    if v_from = 'cancelled' then
        select to_jsonb(r) into v_result from public.rides r where r.id = p_ride_id;
        return v_result;
    end if;
    if v_from not in ('requested','accepted') then raise exception 'ride_cannot_be_cancelled'; end if;

    update public.rides r
    set status = 'cancelled',
        cancellation_reason = trim(p_reason),
        cancelled_at = coalesce(r.cancelled_at, now())
    where r.id = p_ride_id
    returning to_jsonb(r) into v_result;

    perform public.higo_log_ride_event(
        p_ride_id, v_from, 'cancelled', 'passenger.cancel',
        jsonb_build_object('reason', trim(p_reason))
    );
    return v_result;
end;
$$;

grant execute on function public.driver_accept_ride_v2(bigint) to authenticated;
grant execute on function public.driver_mark_arrival_v2(bigint) to authenticated;
grant execute on function public.driver_start_ride_v2(bigint) to authenticated;
grant execute on function public.driver_mark_dropoff_arrival_v2(bigint) to authenticated;
grant execute on function public.driver_complete_ride_v2(bigint) to authenticated;
grant execute on function public.ride_confirm_payment_v2(bigint) to authenticated;
grant execute on function public.passenger_cancel_ride_v2(bigint,text) to authenticated;

commit;
