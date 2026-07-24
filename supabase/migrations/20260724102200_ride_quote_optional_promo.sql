-- A quote without a promotional code must not dereference an unassigned
-- PL/pgSQL record. Keep scalar promo metadata initialized to NULL and expose it
-- only after a valid promotion has been resolved.

begin;

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
    v_promo_id bigint := null;
    v_resolved_promo_code text := null;
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
            v_base := 1.00;
            v_per_km := 0.25;
            v_delivery_fee := 0.50;
            v_stop_fee := 0.50;
        elsif v_type = 'van' then
            v_base := 1.70;
            v_per_km := 0.60;
            v_delivery_fee := 2.00;
            v_stop_fee := 1.00;
        else
            v_base := 1.50;
            v_per_km := 0.40;
            v_delivery_fee := 1.50;
            v_stop_fee := 1.00;
        end if;
    end if;

    v_haversine := public.higo_haversine_km(
        p_pickup_lat,
        p_pickup_lng,
        p_dropoff_lat,
        p_dropoff_lng
    );

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
        when undefined_function then
            v_surge := 1;
        when others then
            v_surge := 1;
    end;
    v_surge := greatest(1, least(coalesce(v_surge, 1), 5));

    v_subtotal := (
        v_base
        + greatest(0, v_distance - 1) * v_per_km
        + v_stops * coalesce(v_stop_fee, 0)
        + case
            when coalesce(p_service_type, 'ride') = 'delivery'
                then coalesce(v_delivery_fee, 0)
            else 0
          end
    ) * v_surge;
    v_subtotal := round(greatest(v_base, v_subtotal), 2);

    if coalesce(trim(p_promo_code), '') <> '' then
        select
            pc.id,
            pc.code,
            pc.discount_type,
            pc.discount_value,
            pc.min_ride_amount,
            pc.expires_at,
            pc.max_uses,
            pc.max_uses_per_user,
            pc.used_count,
            pc.active,
            pc.archived_at,
            pc.budget_amount,
            pc.spent_amount
        into v_promo
        from public.promo_codes pc
        where upper(pc.code) = upper(trim(p_promo_code))
        limit 1;

        if not found then
            v_promo_error := 'inactive';
        else
            v_promo_id := v_promo.id;
            v_resolved_promo_code := v_promo.code;

            if not coalesce(v_promo.active, false)
               or v_promo.archived_at is not null then
                v_promo_error := 'inactive';
            elsif v_promo.expires_at is not null
                  and v_promo.expires_at < now() then
                v_promo_error := 'expired';
            elsif v_subtotal < coalesce(v_promo.min_ride_amount, 0) then
                v_promo_error := 'minimum_not_met';
            elsif v_promo.max_uses is not null
                  and coalesce(v_promo.used_count, 0) >= v_promo.max_uses then
                v_promo_error := 'usage_limit_reached';
            else
                if p_user_id is not null
                   and v_promo.max_uses_per_user is not null then
                    select count(*)
                    into v_user_uses
                    from public.promo_redemptions pr
                    where pr.promo_id = v_promo_id
                      and pr.user_id = p_user_id;
                end if;

                if v_promo.max_uses_per_user is not null
                   and v_user_uses >= v_promo.max_uses_per_user then
                    v_promo_error := 'user_limit_reached';
                else
                    v_discount := case
                        when v_promo.discount_type = 'percent'
                            then v_subtotal * coalesce(v_promo.discount_value, 0) / 100
                        else least(coalesce(v_promo.discount_value, 0), v_subtotal)
                    end;
                    v_discount := round(
                        greatest(0, least(v_discount, v_subtotal)),
                        2
                    );

                    if v_promo.budget_amount is not null
                       and coalesce(v_promo.spent_amount, 0) + v_discount
                           > v_promo.budget_amount then
                        v_discount := 0;
                        v_promo_error := 'budget_exhausted';
                    else
                        v_promo_valid := true;
                    end if;
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
        'deliveryFee', case
            when p_service_type = 'delivery' then v_delivery_fee
            else 0
        end,
        'stopFee', v_stop_fee,
        'surgeMultiplier', v_surge,
        'subtotal', v_subtotal,
        'discount', v_discount,
        'finalPrice', v_final,
        'promoId', case when v_promo_valid then v_promo_id else null end,
        'promoCode', case
            when v_promo_valid then v_resolved_promo_code
            else null
        end,
        'promoValid', v_promo_valid,
        'promoError', v_promo_error,
        'generatedAt', now()
    );
end;
$$;

grant execute on function public.higo_quote_ride_v2(
    double precision,
    double precision,
    double precision,
    double precision,
    text,
    text,
    numeric,
    integer,
    text,
    uuid
) to authenticated;

commit;
