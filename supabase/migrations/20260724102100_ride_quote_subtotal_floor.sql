-- The displayed client subtotal is accepted only as a non-lowering floor.
-- Promotions are recalculated server-side against that subtotal and their
-- budget/redemption counters are updated transactionally.

begin;

create or replace function public.higo_quote_ride_v3(
    p_pickup_lat double precision,
    p_pickup_lng double precision,
    p_dropoff_lat double precision,
    p_dropoff_lng double precision,
    p_vehicle_type text,
    p_service_type text default 'ride',
    p_route_distance_km numeric default null,
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
    v_subtotal numeric;
    v_discount numeric := 0;
    v_final numeric;
    v_floor numeric := greatest(0, coalesce(p_client_subtotal_floor, 0));
    v_promo record;
begin
    v_quote := public.higo_quote_ride_v2(
        p_pickup_lat,
        p_pickup_lng,
        p_dropoff_lat,
        p_dropoff_lng,
        p_vehicle_type,
        p_service_type,
        p_route_distance_km,
        p_stops_count,
        p_promo_code,
        p_user_id
    );

    v_subtotal := greatest(coalesce((v_quote->>'subtotal')::numeric, 0), v_floor);

    if coalesce((v_quote->>'promoValid')::boolean, false) then
        select
            pc.id,
            pc.discount_type,
            pc.discount_value,
            pc.budget_amount,
            pc.spent_amount
        into v_promo
        from public.promo_codes pc
        where pc.id = (v_quote->>'promoId')::bigint;

        v_discount := case
            when v_promo.discount_type = 'percent'
                then v_subtotal * coalesce(v_promo.discount_value, 0) / 100
            else least(coalesce(v_promo.discount_value, 0), v_subtotal)
        end;
        v_discount := round(greatest(0, least(v_discount, v_subtotal)), 2);

        if v_promo.budget_amount is not null
           and coalesce(v_promo.spent_amount, 0) + v_discount > v_promo.budget_amount then
            return v_quote || jsonb_build_object(
                'subtotal', v_subtotal,
                'discount', 0,
                'finalPrice', v_subtotal,
                'promoValid', false,
                'promoError', 'budget_exhausted',
                'clientSubtotalFloor', v_floor,
                'clientSubtotalFloorApplied', v_floor > coalesce((v_quote->>'subtotal')::numeric, 0)
            );
        end if;

        v_quote := v_quote || jsonb_build_object(
            'promoDiscountType', v_promo.discount_type,
            'promoDiscountValue', v_promo.discount_value
        );
    end if;

    v_final := round(greatest(0, v_subtotal - v_discount), 2);
    return v_quote || jsonb_build_object(
        'subtotal', v_subtotal,
        'discount', v_discount,
        'finalPrice', v_final,
        'clientSubtotalFloor', v_floor,
        'clientSubtotalFloorApplied', v_floor > coalesce((v_quote->>'subtotal')::numeric, 0)
    );
end;
$$;

grant execute on function public.higo_quote_ride_v3(
    double precision,double precision,double precision,double precision,
    text,text,numeric,integer,text,uuid,numeric
) to authenticated;

create or replace function public.create_ride_request_v4(
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
    p_terms_version text default null,
    p_client_subtotal_floor numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_created jsonb;
    v_ride public.rides%rowtype;
    v_floor numeric := greatest(0, coalesce(p_client_subtotal_floor, 0));
    v_subtotal numeric;
    v_old_discount numeric;
    v_new_discount numeric;
    v_discount_delta numeric;
    v_promo public.promo_codes%rowtype;
    v_result jsonb;
begin
    v_created := public.create_ride_request_v2(
        p_client_request_id,
        p_pickup,
        p_dropoff,
        p_pickup_lat,
        p_pickup_lng,
        p_dropoff_lat,
        p_dropoff_lng,
        p_vehicle_type,
        p_service_type,
        p_route_distance_km,
        p_stops,
        p_promo_code,
        p_passenger_phone,
        p_delivery_info,
        p_payer,
        p_cod_amount,
        p_terms_version
    );

    select * into v_ride
    from public.rides r
    where r.id = (v_created->>'rideId')::bigint
      and r.user_id = auth.uid()
    for update;

    if not found then
        raise exception 'ride_creation_failed';
    end if;

    v_subtotal := greatest(coalesce(v_ride.price_before_discount, v_ride.price, 0), v_floor);
    v_old_discount := coalesce(v_ride.discount_amount, 0);
    v_new_discount := v_old_discount;

    if v_ride.promo_code_id is not null then
        select * into v_promo
        from public.promo_codes pc
        where pc.id = v_ride.promo_code_id
        for update;

        v_new_discount := case
            when v_promo.discount_type = 'percent'
                then v_subtotal * coalesce(v_promo.discount_value, 0) / 100
            else least(coalesce(v_promo.discount_value, 0), v_subtotal)
        end;
        v_new_discount := round(greatest(0, least(v_new_discount, v_subtotal)), 2);
        v_discount_delta := v_new_discount - v_old_discount;

        if v_promo.budget_amount is not null
           and coalesce(v_promo.spent_amount, 0) + v_discount_delta > v_promo.budget_amount then
            raise exception 'promo_invalid:budget_exhausted';
        end if;

        update public.promo_codes
        set spent_amount = coalesce(spent_amount, 0) + v_discount_delta
        where id = v_promo.id;

        update public.promo_redemptions
        set discount_amount = v_new_discount
        where ride_id = v_ride.id;
    end if;

    update public.rides r
    set price_before_discount = v_subtotal,
        discount_amount = v_new_discount,
        price = round(greatest(0, v_subtotal - v_new_discount), 2),
        pricing_snapshot = coalesce(r.pricing_snapshot, '{}'::jsonb)
            || jsonb_build_object(
                'subtotal', v_subtotal,
                'discount', v_new_discount,
                'finalPrice', round(greatest(0, v_subtotal - v_new_discount), 2),
                'clientSubtotalFloor', v_floor,
                'clientSubtotalFloorApplied', v_floor > coalesce(v_ride.price_before_discount, v_ride.price, 0)
            )
    where r.id = v_ride.id
    returning jsonb_build_object(
        'rideId', r.id,
        'price', r.price,
        'status', r.status,
        'quote', r.pricing_snapshot,
        'idempotentReplay', coalesce((v_created->>'idempotentReplay')::boolean, false)
    ) into v_result;

    return v_result;
end;
$$;

grant execute on function public.create_ride_request_v4(
    uuid,text,text,double precision,double precision,double precision,
    double precision,text,text,numeric,jsonb,text,text,jsonb,text,numeric,text,numeric
) to authenticated;

commit;
