-- Higuerote corridor guard: local reference fares are only valid for
-- Higuerote Centro <-> corridor trips. They must not be reused for arbitrary
-- sector-to-sector trips just because one endpoint happens to be a known name.
--
-- Also register El 50 / Urb. La Arboleda as its own recognized pricing zone.
-- Until a direct current fare is collected, it uses the current Tacarigua
-- reference (Carro/Camioneta $7, Moto $5) as a conservative proxy.

insert into public.higuerote_corridor_fares
    (name, aliases, local_fare, target_fare, moto_local_fare, moto_target_fare, active, note, moto_note)
values (
    'El 50',
    array[
        'el 50',
        'sector el 50',
        'cdi el 50',
        'urb la arboleda el 50',
        'urbanizacion la arboleda el 50',
        'urbanización la arboleda el 50',
        'urb la arboleda',
        'la arboleda'
    ],
    7.00,
    7.00,
    5.00,
    5.00,
    true,
    'Proxy temporal de Tacarigua hasta validar tarifa directa actual de El 50',
    'Proxy temporal de Tacarigua hasta validar tarifa directa actual de El 50'
)
on conflict (name) do update
set aliases = excluded.aliases,
    local_fare = excluded.local_fare,
    target_fare = excluded.target_fare,
    moto_local_fare = excluded.moto_local_fare,
    moto_target_fare = excluded.moto_target_fare,
    active = true,
    note = excluded.note,
    moto_note = excluded.moto_note,
    updated_at = now();

update public.higuerote_corridor_fares
set aliases = (
    select array(
        select distinct x
        from unnest(
            coalesce(aliases, '{}'::text[])
            || array['colinas de tacarigua','tacarigua estadio','tacarigua - estadio']
        ) as t(x)
    )
),
updated_at = now()
where name = 'Tacarigua';

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
    v_base_quote jsonb;
    v_corridor_quote jsonb;
    v_pickup_is_center boolean := false;
    v_dropoff_is_center boolean := false;
begin
    -- Always compute a corridor-free baseline first. Passing an empty label to
    -- V5 prevents a named destination from accidentally forcing a local
    -- Higuerote-Centro fare on an unrelated sector-to-sector trip.
    v_base_quote := public.higo_quote_ride_v5(
        p_pickup_lat, p_pickup_lng,
        p_dropoff_lat, p_dropoff_lng,
        '', p_vehicle_type, p_service_type,
        p_route_distance_km, p_route_duration_min,
        p_stops_count, p_promo_code, p_user_id,
        p_client_subtotal_floor
    );

    if coalesce(p_service_type, 'ride') <> 'ride' then
        return v_base_quote || jsonb_build_object(
            'corridorDirection', null,
            'corridorSourceLabel', null
        );
    end if;

    v_pickup_is_center :=
        public.higo_is_higuerote_center_label(p_pickup)
        or public.higo_is_higuerote_center_point(p_pickup_lat, p_pickup_lng);

    v_dropoff_is_center :=
        public.higo_is_higuerote_center_label(p_dropoff)
        or public.higo_is_higuerote_center_point(p_dropoff_lat, p_dropoff_lng);

    -- Outbound reference fare: Higuerote Centro -> known corridor.
    if v_pickup_is_center and not v_dropoff_is_center then
        v_corridor_quote := public.higo_quote_ride_v5(
            p_pickup_lat, p_pickup_lng,
            p_dropoff_lat, p_dropoff_lng,
            p_dropoff, p_vehicle_type, p_service_type,
            p_route_distance_km, p_route_duration_min,
            p_stops_count, p_promo_code, p_user_id,
            p_client_subtotal_floor
        );

        if coalesce((v_corridor_quote->>'corridorApplied')::boolean, false) then
            return v_corridor_quote || jsonb_build_object(
                'corridorDirection', 'outbound',
                'corridorSourceLabel', p_dropoff
            );
        end if;
    end if;

    -- Reverse reference fare: known corridor -> Higuerote Centro.
    if v_dropoff_is_center and not v_pickup_is_center then
        v_corridor_quote := public.higo_quote_ride_v5(
            p_pickup_lat, p_pickup_lng,
            p_dropoff_lat, p_dropoff_lng,
            p_pickup, p_vehicle_type, p_service_type,
            p_route_distance_km, p_route_duration_min,
            p_stops_count, p_promo_code, p_user_id,
            p_client_subtotal_floor
        );

        if coalesce((v_corridor_quote->>'corridorApplied')::boolean, false) then
            return v_corridor_quote || jsonb_build_object(
                'corridorDirection', 'reverse',
                'corridorSourceLabel', p_pickup
            );
        end if;
    end if;

    return v_base_quote || jsonb_build_object(
        'corridorDirection', null,
        'corridorSourceLabel', null
    );
end;
$$;

grant execute on function public.higo_quote_ride_v6(
    double precision,double precision,double precision,double precision,
    text,text,text,text,numeric,numeric,integer,text,uuid,numeric
) to anon, authenticated;

notify pgrst, 'reload schema';
