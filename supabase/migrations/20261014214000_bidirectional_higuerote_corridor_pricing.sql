-- Bidirectional Higuerote corridor pricing.
-- Local tariffs are defined from Higuerote Centro to a destination, so the
-- same reference must apply when the passenger travels the exact route back.

create or replace function public.higo_is_higuerote_center_label(p_value text)
returns boolean
language sql
immutable
as $$
    select case
        when p_value is null then false
        else public.higo_normalize_place_label(p_value) in ('higuerote','higuerote centro','centro higuerote')
          or public.higo_normalize_place_label(p_value) like '%higuerote centro%'
          or public.higo_normalize_place_label(p_value) like '%centro de higuerote%'
    end;
$$;

create or replace function public.higo_is_higuerote_center_point(
    p_lat double precision,
    p_lng double precision
)
returns boolean
language sql
immutable
as $$
    select case
        when p_lat is null or p_lng is null then false
        else (
            6371.0 * acos(
                least(1.0, greatest(-1.0,
                    sin(radians(p_lat)) * sin(radians(10.48483773064799))
                    + cos(radians(p_lat)) * cos(radians(10.48483773064799))
                    * cos(radians(p_lng - (-66.09798352908754)))
                ))
            )
        ) <= 3.0
    end;
$$;

create or replace function public.higo_quote_ride_v6(
    p_pickup_lat double precision,
    p_pickup_lng double precision,
    p_dropoff_lat double precision,
    p_dropoff_lng double precision,
    p_pickup text,
    p_dropoff text,
    p_vehicle_type text,
    p_service_type text default 'ride',
    p_route_distance_km numeric default null,
    p_route_duration_min numeric default null,
    p_stops_count integer default 0,
    p_promo_code text default null,
    p_user_id uuid default auth.uid(),
    p_client_subtotal_floor numeric default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_quote jsonb;
    v_reverse_quote jsonb;
    v_destination_is_center boolean := false;
begin
    v_quote := public.higo_quote_ride_v5(
        p_pickup_lat, p_pickup_lng,
        p_dropoff_lat, p_dropoff_lng,
        p_dropoff, p_vehicle_type, p_service_type,
        p_route_distance_km, p_route_duration_min,
        p_stops_count, p_promo_code, p_user_id,
        p_client_subtotal_floor
    );

    if coalesce((v_quote->>'corridorApplied')::boolean, false) then
        return v_quote || jsonb_build_object(
            'corridorDirection', 'outbound',
            'corridorSourceLabel', p_dropoff
        );
    end if;

    v_destination_is_center :=
        public.higo_is_higuerote_center_label(p_dropoff)
        or public.higo_is_higuerote_center_point(p_dropoff_lat, p_dropoff_lng);

    if coalesce(p_service_type, 'ride') = 'ride' and v_destination_is_center then
        v_reverse_quote := public.higo_quote_ride_v5(
            p_pickup_lat, p_pickup_lng,
            p_dropoff_lat, p_dropoff_lng,
            p_pickup, p_vehicle_type, p_service_type,
            p_route_distance_km, p_route_duration_min,
            p_stops_count, p_promo_code, p_user_id,
            p_client_subtotal_floor
        );

        if coalesce((v_reverse_quote->>'corridorApplied')::boolean, false) then
            return v_reverse_quote || jsonb_build_object(
                'corridorDirection', 'reverse',
                'corridorSourceLabel', p_pickup
            );
        end if;
    end if;

    return v_quote || jsonb_build_object(
        'corridorDirection', null,
        'corridorSourceLabel', null
    );
end;
$$;

grant execute on function public.higo_quote_ride_v6(
    double precision,double precision,double precision,double precision,
    text,text,text,text,numeric,numeric,integer,text,uuid,numeric
) to anon, authenticated;

create or replace function public.create_ride_request_v7(
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
    p_route_duration_min numeric default null,
    p_stops jsonb default '[]'::jsonb,
    p_promo_code text default null,
    p_passenger_phone text default null,
    p_delivery_info jsonb default null,
    p_payer text default null,
    p_cod_amount numeric default null,
    p_terms_version text default null,
    p_client_subtotal_floor numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_stops_count integer := case when jsonb_typeof(coalesce(p_stops,'[]'::jsonb))='array'
        then jsonb_array_length(coalesce(p_stops,'[]'::jsonb)) else 0 end;
    v_quote jsonb;
    v_created jsonb;
    v_ride public.rides%rowtype;
    v_old_discount numeric := 0;
    v_new_discount numeric := 0;
    v_discount_delta numeric := 0;
    v_promo public.promo_codes%rowtype;
    v_result jsonb;
begin
    if v_user_id is null then
        raise exception 'authentication_required' using errcode = '42501';
    end if;

    v_quote := public.higo_quote_ride_v6(
        p_pickup_lat, p_pickup_lng,
        p_dropoff_lat, p_dropoff_lng,
        p_pickup, p_dropoff, p_vehicle_type, p_service_type,
        p_route_distance_km, p_route_duration_min,
        v_stops_count, p_promo_code, v_user_id,
        p_client_subtotal_floor
    );

    if coalesce(trim(p_promo_code),'') <> ''
       and not coalesce((v_quote->>'promoValid')::boolean,false) then
        raise exception 'promo_invalid:%', coalesce(v_quote->>'promoError','unknown');
    end if;

    v_created := public.create_ride_request_v5(
        p_client_request_id, p_pickup, p_dropoff,
        p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng,
        p_vehicle_type, p_service_type, p_route_distance_km,
        p_route_duration_min, p_stops, p_promo_code,
        p_passenger_phone, p_delivery_info, p_payer, p_cod_amount,
        p_terms_version, p_client_subtotal_floor
    );

    select * into v_ride
    from public.rides r
    where r.id = (v_created->>'rideId')::bigint
      and r.user_id = v_user_id
    for update;

    if not found then
        raise exception 'ride_creation_failed';
    end if;

    v_old_discount := coalesce(v_ride.discount_amount,0);
    v_new_discount := greatest(0, coalesce((v_quote->>'discount')::numeric,0));
    v_discount_delta := v_new_discount - v_old_discount;

    if v_ride.promo_code_id is not null and v_discount_delta <> 0 then
        select * into v_promo
        from public.promo_codes pc
        where pc.id = v_ride.promo_code_id
        for update;

        if v_promo.budget_amount is not null
           and coalesce(v_promo.spent_amount,0) + v_discount_delta > v_promo.budget_amount then
            raise exception 'promo_invalid:budget_exhausted';
        end if;

        update public.promo_codes
        set spent_amount = greatest(0, coalesce(spent_amount,0) + v_discount_delta)
        where id = v_promo.id;

        update public.promo_redemptions
        set discount_amount = v_new_discount
        where ride_id = v_ride.id;
    end if;

    update public.rides r
    set quoted_distance_km = coalesce((v_quote->>'distanceKm')::numeric, r.quoted_distance_km),
        quoted_duration_min = coalesce((v_quote->>'durationMin')::numeric, r.quoted_duration_min),
        pricing_version = coalesce((v_quote->>'pricingVersion')::integer, r.pricing_version),
        pricing_model = coalesce(v_quote->>'pricingModel', r.pricing_model),
        pricing_multiplier = coalesce((v_quote->>'surgeMultiplier')::numeric, r.pricing_multiplier),
        pricing_multiplier_reason = coalesce(v_quote->>'multiplierReason', r.pricing_multiplier_reason),
        pricing_base_amount = coalesce((v_quote->>'base')::numeric, r.pricing_base_amount),
        pricing_distance_amount = coalesce((v_quote->>'distanceAmount')::numeric, r.pricing_distance_amount),
        pricing_time_amount = coalesce((v_quote->>'timeAmount')::numeric, r.pricing_time_amount),
        pricing_stops_amount = coalesce((v_quote->>'stopsAmount')::numeric, r.pricing_stops_amount),
        pricing_extras_amount = coalesce((v_quote->>'extrasAmount')::numeric, r.pricing_extras_amount),
        pricing_minimum_fare = coalesce((v_quote->>'minimumFare')::numeric, r.pricing_minimum_fare),
        price_before_discount = (v_quote->>'subtotal')::numeric,
        discount_amount = v_new_discount,
        price = (v_quote->>'finalPrice')::numeric,
        pricing_snapshot = v_quote
    where r.id = v_ride.id;

    update public.pricing_quote_audit
    set rollout_mode = coalesce(v_quote->>'rolloutMode', rollout_mode),
        model_applied = coalesce((v_quote->>'modelApplied')::boolean, model_applied),
        pilot_bucket = coalesce((v_quote->>'pilotBucket')::integer, pilot_bucket),
        distance_km = coalesce((v_quote->>'distanceKm')::numeric, distance_km),
        duration_min = coalesce((v_quote->>'durationMin')::numeric, duration_min),
        legacy_subtotal = coalesce((v_quote->>'legacySubtotal')::numeric, legacy_subtotal),
        model_subtotal = coalesce((v_quote->>'modelSubtotal')::numeric, model_subtotal),
        charged_subtotal = (v_quote->>'subtotal')::numeric,
        quote = v_quote
    where ride_id = v_ride.id;

    select jsonb_build_object(
        'rideId', r.id,
        'price', r.price,
        'status', r.status,
        'quote', r.pricing_snapshot,
        'idempotentReplay', coalesce((v_created->>'idempotentReplay')::boolean,false)
    )
    into v_result
    from public.rides r
    where r.id = v_ride.id;

    return v_result;
end;
$$;

grant execute on function public.create_ride_request_v7(
    uuid,text,text,double precision,double precision,double precision,double precision,
    text,text,numeric,numeric,jsonb,text,text,jsonb,text,numeric,text,numeric
) to authenticated;

notify pgrst, 'reload schema';
