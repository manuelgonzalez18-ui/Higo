-- Compatibility wrapper for clients that have not yet serialized every stop.
-- The client-displayed final price may raise the server quote, but can never
-- lower it. This preserves stop-inclusive pricing while the server remains the
-- authority against tampering.

begin;

create or replace function public.create_ride_request_v3(
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
    p_client_price_floor numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_created jsonb;
    v_ride_id bigint;
    v_result jsonb;
    v_floor numeric := greatest(0, coalesce(p_client_price_floor, 0));
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

    v_ride_id := nullif(v_created->>'rideId', '')::bigint;
    if v_ride_id is null then
        raise exception 'ride_creation_failed';
    end if;

    if v_floor > 0 then
        update public.rides r
        set price = greatest(coalesce(r.price, 0), v_floor),
            price_before_discount = greatest(
                coalesce(r.price_before_discount, 0),
                v_floor + coalesce(r.discount_amount, 0)
            ),
            pricing_snapshot = coalesce(r.pricing_snapshot, '{}'::jsonb)
                || jsonb_build_object(
                    'clientPriceFloor', v_floor,
                    'clientPriceFloorApplied', v_floor > coalesce((r.pricing_snapshot->>'finalPrice')::numeric, 0)
                )
        where r.id = v_ride_id
          and r.user_id = auth.uid();
    end if;

    select jsonb_build_object(
        'rideId', r.id,
        'price', r.price,
        'status', r.status,
        'quote', r.pricing_snapshot,
        'idempotentReplay', coalesce((v_created->>'idempotentReplay')::boolean, false)
    )
    into v_result
    from public.rides r
    where r.id = v_ride_id
      and r.user_id = auth.uid();

    return v_result;
end;
$$;

grant execute on function public.create_ride_request_v3(
    uuid, text, text, double precision, double precision,
    double precision, double precision, text, text, numeric, jsonb,
    text, text, jsonb, text, numeric, text, numeric
) to authenticated;

commit;
