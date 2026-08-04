-- Higo Viajes: centro operativo administrativo para viajes de pasajeros.
--
-- Expone listado paginado, detalle integral, métricas y overrides auditados.
-- El dinero de los viajes se reporta como volumen pasajero -> driver, nunca
-- como ingreso propio de Higo.

begin;

create index if not exists idx_rides_service_created_id
    on public.rides(service_type, created_at desc, id desc);
create index if not exists idx_rides_service_status_created_id
    on public.rides(service_type, status, created_at desc, id desc);
create index if not exists idx_rides_user_created_id
    on public.rides(user_id, created_at desc, id desc);
create index if not exists idx_rides_driver_created_id
    on public.rides(driver_id, created_at desc, id desc)
    where driver_id is not null;

create or replace function public.admin_list_rides(
    p_status_bucket text default 'active',
    p_date_from timestamptz default null,
    p_date_to timestamptz default null,
    p_query text default null,
    p_vehicle_type text default null,
    p_has_promo boolean default null,
    p_has_incident boolean default null,
    p_limit integer default 50,
    p_cursor_created_at timestamptz default null,
    p_cursor_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
    v_items jsonb := '[]'::jsonb;
    v_has_more boolean := false;
    v_next_created_at timestamptz;
    v_next_id bigint;
begin
    perform public.higo_assert_admin('manage_operations');

    with candidates as (
        select
            r.id as ride_id,
            r.created_at,
            to_jsonb(r) as ride,
            jsonb_strip_nulls(jsonb_build_object(
                'id', passenger.id,
                'full_name', passenger.full_name,
                'email', passenger.email,
                'phone', coalesce(r.passenger_phone, passenger.phone),
                'avatar_url', passenger.avatar_url,
                'status', passenger.status,
                'created_at', passenger.created_at
            )) as passenger,
            jsonb_strip_nulls(jsonb_build_object(
                'id', driver.id,
                'full_name', driver.full_name,
                'email', driver.email,
                'phone', driver.phone,
                'avatar_url', driver.avatar_url,
                'status', driver.status,
                'vehicle_type', driver.vehicle_type,
                'vehicle_brand', driver.vehicle_brand,
                'vehicle_model', driver.vehicle_model,
                'vehicle_color', driver.vehicle_color,
                'license_plate', driver.license_plate,
                'suspended_at', driver.suspended_at
            )) as driver,
            jsonb_build_object(
                'total', coalesce(offers.total, 0),
                'offered', coalesce(offers.offered, 0),
                'accepted', coalesce(offers.accepted, 0),
                'expired', coalesce(offers.expired, 0),
                'withdrawn', coalesce(offers.withdrawn, 0),
                'maxWave', coalesce(offers.max_wave, 0),
                'firstOfferAt', offers.first_offer_at,
                'acceptedAt', offers.accepted_at,
                'acceptedDistanceKm', offers.accepted_distance_km
            ) as offer_summary,
            coalesce(to_jsonb(dispatch_row), '{}'::jsonb) as dispatch,
            coalesce(support.open_count, 0) as open_support_count,
            coalesce(fraud.signal_count, 0) as fraud_signal_count,
            (
                r.payment_confirmed_at is null
                and (
                    r.payment_reference is not null
                    or coalesce(r.payment_confirmed_by_user, false)
                    or coalesce(r.payment_confirmed_by_driver, false)
                )
            ) as has_payment_dispute,
            (
                coalesce(fraud.signal_count, 0) > 0
                or (
                    r.payment_confirmed_at is null
                    and (
                        r.payment_reference is not null
                        or coalesce(r.payment_confirmed_by_user, false)
                        or coalesce(r.payment_confirmed_by_driver, false)
                    )
                )
            ) as has_incident,
            extract(epoch from (
                coalesce(r.accepted_at, offers.accepted_at) - r.created_at
            ))::integer as assignment_seconds,
            extract(epoch from (
                coalesce(r.completed_at, r.cancelled_at, now())
                - coalesce(r.started_at, r.accepted_at, r.created_at)
            ))::integer as lifecycle_seconds
        from public.rides r
        left join public.profiles passenger on passenger.id = r.user_id
        left join public.profiles driver on driver.id = r.driver_id
        left join public.ride_dispatches dispatch_row on dispatch_row.ride_id = r.id
        left join lateral (
            select
                count(*)::integer as total,
                count(*) filter (where o.status = 'offered')::integer as offered,
                count(*) filter (where o.status = 'accepted')::integer as accepted,
                count(*) filter (where o.status = 'expired')::integer as expired,
                count(*) filter (where o.status = 'withdrawn')::integer as withdrawn,
                max(o.wave_number)::integer as max_wave,
                min(o.offered_at) as first_offer_at,
                max(o.responded_at) filter (where o.status = 'accepted') as accepted_at,
                max(o.distance_km) filter (where o.status = 'accepted') as accepted_distance_km
            from public.ride_offers o
            where o.ride_id = r.id
        ) offers on true
        left join lateral (
            select count(*) filter (where st.status = 'open')::integer as open_count
            from public.support_threads st
            where st.user_id = r.user_id or st.user_id = r.driver_id
        ) support on true
        left join lateral (
            select count(*)::integer as signal_count
            from public.fraud_signals fs
            where fs.subject_type = 'ride'
              and fs.subject_id = r.id::text
        ) fraud on true
        where coalesce(r.service_type, 'ride') <> 'delivery'
          and (p_date_from is null or r.created_at >= p_date_from)
          and (p_date_to is null or r.created_at < p_date_to)
          and (
              coalesce(trim(p_status_bucket), 'active') = 'all'
              or (p_status_bucket = 'active' and r.status in ('requested','accepted','in_progress','arrived_at_dropoff'))
              or (p_status_bucket = 'completed' and r.status = 'completed')
              or (p_status_bucket = 'cancelled' and r.status = 'cancelled')
              or (p_status_bucket not in ('active','completed','cancelled','all') and r.status = p_status_bucket)
          )
          and (
              coalesce(trim(p_vehicle_type), '') = ''
              or public.higo_canonical_vehicle_type(r.ride_type)
                    = public.higo_canonical_vehicle_type(p_vehicle_type)
          )
          and (
              p_has_promo is null
              or p_has_promo = (r.promo_code_id is not null)
          )
          and (
              p_has_incident is null
              or p_has_incident = (
                  coalesce(fraud.signal_count, 0) > 0
                  or (
                      r.payment_confirmed_at is null
                      and (
                          r.payment_reference is not null
                          or coalesce(r.payment_confirmed_by_user, false)
                          or coalesce(r.payment_confirmed_by_driver, false)
                      )
                  )
              )
          )
          and (
              coalesce(trim(p_query), '') = ''
              or r.id::text = trim(p_query)
              or r.pickup ilike '%' || trim(p_query) || '%'
              or r.dropoff ilike '%' || trim(p_query) || '%'
              or coalesce(r.passenger_phone, '') ilike '%' || trim(p_query) || '%'
              or coalesce(r.payment_reference, '') ilike '%' || trim(p_query) || '%'
              or coalesce(passenger.full_name, '') ilike '%' || trim(p_query) || '%'
              or coalesce(passenger.email, '') ilike '%' || trim(p_query) || '%'
              or coalesce(passenger.phone, '') ilike '%' || trim(p_query) || '%'
              or coalesce(driver.full_name, '') ilike '%' || trim(p_query) || '%'
              or coalesce(driver.email, '') ilike '%' || trim(p_query) || '%'
              or coalesce(driver.phone, '') ilike '%' || trim(p_query) || '%'
              or coalesce(driver.license_plate, '') ilike '%' || trim(p_query) || '%'
          )
          and (
              p_cursor_created_at is null
              or r.created_at < p_cursor_created_at
              or (r.created_at = p_cursor_created_at and r.id < coalesce(p_cursor_id, 9223372036854775807))
          )
        order by r.created_at desc, r.id desc
        limit v_limit + 1
    ),
    page as (
        select * from candidates
        order by created_at desc, ride_id desc
        limit v_limit
    )
    select coalesce(jsonb_agg(
        p.ride || jsonb_build_object(
            'passenger', p.passenger,
            'driver', p.driver,
            'offerSummary', p.offer_summary,
            'dispatch', p.dispatch,
            'openSupportCount', p.open_support_count,
            'fraudSignalCount', p.fraud_signal_count,
            'hasPaymentDispute', p.has_payment_dispute,
            'hasIncident', p.has_incident,
            'assignmentSeconds', p.assignment_seconds,
            'lifecycleSeconds', p.lifecycle_seconds
        ) order by p.created_at desc, p.ride_id desc
    ), '[]'::jsonb)
    into v_items
    from page p;

    with candidates as (
        select r.id, r.created_at
        from public.rides r
        left join public.profiles passenger on passenger.id = r.user_id
        left join public.profiles driver on driver.id = r.driver_id
        left join lateral (
            select count(*)::integer as signal_count
            from public.fraud_signals fs
            where fs.subject_type = 'ride' and fs.subject_id = r.id::text
        ) fraud on true
        where coalesce(r.service_type, 'ride') <> 'delivery'
          and (p_date_from is null or r.created_at >= p_date_from)
          and (p_date_to is null or r.created_at < p_date_to)
          and (
              coalesce(trim(p_status_bucket), 'active') = 'all'
              or (p_status_bucket = 'active' and r.status in ('requested','accepted','in_progress','arrived_at_dropoff'))
              or (p_status_bucket = 'completed' and r.status = 'completed')
              or (p_status_bucket = 'cancelled' and r.status = 'cancelled')
              or (p_status_bucket not in ('active','completed','cancelled','all') and r.status = p_status_bucket)
          )
          and (coalesce(trim(p_vehicle_type), '') = '' or public.higo_canonical_vehicle_type(r.ride_type) = public.higo_canonical_vehicle_type(p_vehicle_type))
          and (p_has_promo is null or p_has_promo = (r.promo_code_id is not null))
          and (p_has_incident is null or p_has_incident = (coalesce(fraud.signal_count, 0) > 0 or (r.payment_confirmed_at is null and (r.payment_reference is not null or coalesce(r.payment_confirmed_by_user, false) or coalesce(r.payment_confirmed_by_driver, false)))))
          and (
              coalesce(trim(p_query), '') = ''
              or r.id::text = trim(p_query)
              or r.pickup ilike '%' || trim(p_query) || '%'
              or r.dropoff ilike '%' || trim(p_query) || '%'
              or coalesce(r.passenger_phone, '') ilike '%' || trim(p_query) || '%'
              or coalesce(r.payment_reference, '') ilike '%' || trim(p_query) || '%'
              or coalesce(passenger.full_name, '') ilike '%' || trim(p_query) || '%'
              or coalesce(passenger.email, '') ilike '%' || trim(p_query) || '%'
              or coalesce(passenger.phone, '') ilike '%' || trim(p_query) || '%'
              or coalesce(driver.full_name, '') ilike '%' || trim(p_query) || '%'
              or coalesce(driver.email, '') ilike '%' || trim(p_query) || '%'
              or coalesce(driver.phone, '') ilike '%' || trim(p_query) || '%'
              or coalesce(driver.license_plate, '') ilike '%' || trim(p_query) || '%'
          )
          and (
              p_cursor_created_at is null
              or r.created_at < p_cursor_created_at
              or (r.created_at = p_cursor_created_at and r.id < coalesce(p_cursor_id, 9223372036854775807))
          )
        order by r.created_at desc, r.id desc
        limit v_limit + 1
    )
    select count(*) > v_limit into v_has_more from candidates;

    if v_has_more and jsonb_array_length(v_items) > 0 then
        select
            (item->>'created_at')::timestamptz,
            (item->>'id')::bigint
        into v_next_created_at, v_next_id
        from jsonb_array_elements(v_items) with ordinality entries(item, ord)
        order by ord desc
        limit 1;
    end if;

    return jsonb_build_object(
        'items', v_items,
        'hasMore', v_has_more,
        'nextCursor', case when v_has_more then jsonb_build_object(
            'createdAt', v_next_created_at,
            'id', v_next_id
        ) else null end,
        'generatedAt', now()
    );
end;
$$;

create or replace function public.admin_get_ride_detail(p_ride_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_result jsonb;
begin
    perform public.higo_assert_admin('manage_operations');

    select jsonb_build_object(
        'ride', to_jsonb(r),
        'passenger', jsonb_strip_nulls(jsonb_build_object(
            'id', passenger.id,
            'full_name', passenger.full_name,
            'email', passenger.email,
            'phone', coalesce(r.passenger_phone, passenger.phone),
            'avatar_url', passenger.avatar_url,
            'status', passenger.status,
            'created_at', passenger.created_at
        )),
        'driver', jsonb_strip_nulls(jsonb_build_object(
            'id', driver.id,
            'full_name', driver.full_name,
            'email', driver.email,
            'phone', driver.phone,
            'avatar_url', driver.avatar_url,
            'status', driver.status,
            'vehicle_type', driver.vehicle_type,
            'vehicle_brand', driver.vehicle_brand,
            'vehicle_model', driver.vehicle_model,
            'vehicle_color', driver.vehicle_color,
            'license_plate', driver.license_plate,
            'last_location_update', driver.last_location_update,
            'suspended_at', driver.suspended_at,
            'subscription_status', driver.subscription_status
        )),
        'route', jsonb_build_object(
            'pickup', r.pickup,
            'dropoff', r.dropoff,
            'pickupLat', r.pickup_lat,
            'pickupLng', r.pickup_lng,
            'dropoffLat', r.dropoff_lat,
            'dropoffLng', r.dropoff_lng,
            'stops', coalesce(r.stops, '[]'::jsonb),
            'quotedDistanceKm', r.quoted_distance_km
        ),
        'timeline', jsonb_build_object(
            'createdAt', r.created_at,
            'acceptedAt', r.accepted_at,
            'arrivedPickupAt', r.arrived_at_pickup_at,
            'startedAt', r.started_at,
            'arrivedDropoffAt', r.arrived_at_dropoff_at,
            'completedAt', r.completed_at,
            'cancelledAt', r.cancelled_at,
            'updatedAt', r.updated_at
        ),
        'pricing', jsonb_build_object(
            'price', r.price,
            'priceBeforeDiscount', r.price_before_discount,
            'discountAmount', r.discount_amount,
            'waitSeconds', r.wait_seconds,
            'waitFee', r.wait_fee,
            'promoCodeId', r.promo_code_id,
            'snapshot', r.pricing_snapshot,
            'pricingVersion', r.pricing_version,
            'pricingModel', r.pricing_model,
            'multiplier', r.pricing_multiplier,
            'multiplierReason', r.pricing_multiplier_reason,
            'baseAmount', r.pricing_base_amount,
            'distanceAmount', r.pricing_distance_amount,
            'timeAmount', r.pricing_time_amount,
            'stopsAmount', r.pricing_stops_amount,
            'extrasAmount', r.pricing_extras_amount,
            'minimumFare', r.pricing_minimum_fare
        ),
        'payment', jsonb_build_object(
            'method', r.payment_method,
            'reference', r.payment_reference,
            'confirmedByPassenger', r.payment_confirmed_by_user,
            'confirmedByDriver', r.payment_confirmed_by_driver,
            'confirmedAt', r.payment_confirmed_at,
            'hasDispute', r.payment_confirmed_at is null and (
                r.payment_reference is not null
                or coalesce(r.payment_confirmed_by_user, false)
                or coalesce(r.payment_confirmed_by_driver, false)
            )
        ),
        'promo', case when promo.id is null then null else to_jsonb(promo) end,
        'dispatch', coalesce((
            select to_jsonb(rd) from public.ride_dispatches rd where rd.ride_id = r.id
        ), '{}'::jsonb),
        'offers', coalesce((
            select jsonb_agg(
                to_jsonb(o) || jsonb_build_object(
                    'driverName', op.full_name,
                    'driverPhone', op.phone,
                    'licensePlate', op.license_plate,
                    'vehicleModel', op.vehicle_model
                ) order by o.offered_at, o.rank_position nulls last, o.id
            )
            from public.ride_offers o
            left join public.profiles op on op.id = o.driver_id
            where o.ride_id = r.id
        ), '[]'::jsonb),
        'events', coalesce((
            select jsonb_agg(
                to_jsonb(e) || jsonb_build_object('actorName', actor.full_name)
                order by e.created_at, e.id
            )
            from public.ride_state_events e
            left join public.profiles actor on actor.id = e.actor_id
            where e.ride_id = r.id
        ), '[]'::jsonb),
        'supportThreads', coalesce((
            select jsonb_agg(to_jsonb(st) order by st.updated_at desc)
            from public.support_threads st
            where st.user_id = r.user_id or st.user_id = r.driver_id
        ), '[]'::jsonb),
        'fraudSignals', coalesce((
            select jsonb_agg(to_jsonb(fs) order by fs.computed_at desc)
            from public.fraud_signals fs
            where fs.subject_type = 'ride' and fs.subject_id = r.id::text
        ), '[]'::jsonb),
        'auditLog', coalesce((
            select jsonb_agg(to_jsonb(al) order by al.created_at desc)
            from (
                select * from public.admin_audit_log
                where entity_type in ('ride','rides') and entity_id = r.id::text
                order by created_at desc
                limit 50
            ) al
        ), '[]'::jsonb),
        'termsAcceptances', coalesce((
            select jsonb_agg(to_jsonb(ta) order by ta.accepted_at desc)
            from public.terms_acceptances ta
            where ta.ride_id = r.id
        ), '[]'::jsonb),
        'metrics', jsonb_build_object(
            'assignmentSeconds', extract(epoch from (r.accepted_at - r.created_at))::integer,
            'pickupWaitSeconds', extract(epoch from (r.started_at - r.arrived_at_pickup_at))::integer,
            'tripSeconds', extract(epoch from (r.completed_at - r.started_at))::integer,
            'totalLifecycleSeconds', extract(epoch from (
                coalesce(r.completed_at, r.cancelled_at, now()) - r.created_at
            ))::integer
        )
    )
    into v_result
    from public.rides r
    left join public.profiles passenger on passenger.id = r.user_id
    left join public.profiles driver on driver.id = r.driver_id
    left join public.promo_codes promo on promo.id = r.promo_code_id
    where r.id = p_ride_id
      and coalesce(r.service_type, 'ride') <> 'delivery';

    if v_result is null then
        raise exception 'ride_not_found' using errcode = 'P0002';
    end if;

    return v_result;
end;
$$;

create or replace function public.admin_ride_operations_metrics(
    p_date_from timestamptz default null,
    p_date_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_result jsonb;
begin
    perform public.higo_assert_admin('manage_operations');

    with base as (
        select r.*
        from public.rides r
        where coalesce(r.service_type, 'ride') <> 'delivery'
          and (p_date_from is null or r.created_at >= p_date_from)
          and (p_date_to is null or r.created_at < p_date_to)
    ), metrics as (
        select
            count(*)::integer as total,
            count(*) filter (where status in ('requested','accepted','in_progress','arrived_at_dropoff'))::integer as active,
            count(*) filter (where status = 'completed')::integer as completed,
            count(*) filter (where status = 'cancelled')::integer as cancelled,
            count(distinct user_id)::integer as unique_passengers,
            count(distinct driver_id) filter (where driver_id is not null)::integer as unique_drivers,
            coalesce(sum(price) filter (where status = 'completed'), 0) as transacted_volume,
            coalesce(avg(price) filter (where status = 'completed'), 0) as average_price,
            avg(extract(epoch from (accepted_at - created_at))) filter (where accepted_at is not null) as avg_assignment_seconds,
            avg(extract(epoch from (completed_at - started_at))) filter (where completed_at is not null and started_at is not null) as avg_trip_seconds,
            count(*) filter (
                where payment_confirmed_at is null
                  and (payment_reference is not null or coalesce(payment_confirmed_by_user, false) or coalesce(payment_confirmed_by_driver, false))
            )::integer as payment_disputes,
            count(*) filter (where promo_code_id is not null)::integer as promo_rides,
            count(*) filter (where pricing_version = 4)::integer as pricing_v4_rides
        from base
    ), fraud as (
        select count(distinct fs.subject_id)::integer as ride_count
        from public.fraud_signals fs
        join base b on b.id::text = fs.subject_id
        where fs.subject_type = 'ride'
    )
    select jsonb_build_object(
        'total', m.total,
        'active', m.active,
        'completed', m.completed,
        'cancelled', m.cancelled,
        'completionRate', case when m.total = 0 then 0 else round(m.completed::numeric / m.total::numeric, 4) end,
        'uniquePassengers', m.unique_passengers,
        'uniqueDrivers', m.unique_drivers,
        'transactedVolume', round(m.transacted_volume, 2),
        'averagePrice', round(m.average_price, 2),
        'avgAssignmentSeconds', round(coalesce(m.avg_assignment_seconds, 0)::numeric, 2),
        'avgTripSeconds', round(coalesce(m.avg_trip_seconds, 0)::numeric, 2),
        'paymentDisputes', m.payment_disputes,
        'fraudSignals', coalesce(f.ride_count, 0),
        'promoRides', m.promo_rides,
        'pricingV4Rides', m.pricing_v4_rides,
        'generatedAt', now()
    ) into v_result
    from metrics m cross join fraud f;

    return v_result;
end;
$$;

create or replace function public.admin_override_ride_status(
    p_ride_id bigint,
    p_target_status text,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_before public.rides%rowtype;
    v_after jsonb;
    v_target text := lower(trim(coalesce(p_target_status, '')));
begin
    perform public.higo_assert_admin('manage_operations', true);

    if v_target not in ('completed','cancelled') then
        raise exception 'invalid_admin_ride_target_status';
    end if;
    if coalesce(trim(p_reason), '') = '' then
        raise exception 'admin_ride_reason_required';
    end if;

    select * into v_before
    from public.rides r
    where r.id = p_ride_id
      and coalesce(r.service_type, 'ride') <> 'delivery'
    for update;

    if not found then raise exception 'ride_not_found'; end if;
    if v_before.status in ('completed','cancelled') then
        if v_before.status = v_target then return to_jsonb(v_before); end if;
        raise exception 'terminal_ride_cannot_be_overridden';
    end if;
    if v_target = 'completed' and v_before.status not in ('accepted','in_progress','arrived_at_dropoff') then
        raise exception 'ride_not_ready_for_completion';
    end if;

    update public.rides r
    set status = v_target,
        completed_at = case when v_target = 'completed' then coalesce(r.completed_at, now()) else r.completed_at end,
        cancelled_at = case when v_target = 'cancelled' then coalesce(r.cancelled_at, now()) else r.cancelled_at end,
        cancellation_reason = case when v_target = 'cancelled' then trim(p_reason) else r.cancellation_reason end,
        updated_at = now()
    where r.id = p_ride_id
    returning to_jsonb(r) into v_after;

    perform public.higo_log_ride_event(
        p_ride_id,
        v_before.status,
        v_target,
        'admin.override',
        jsonb_build_object('reason', trim(p_reason), 'actorRole', public.higo_admin_role())
    );

    insert into public.admin_audit_log(
        actor_id, action, entity_type, entity_id, before_data, after_data, reason, metadata
    ) values (
        auth.uid(),
        'ride.override_' || v_target,
        'ride',
        p_ride_id::text,
        to_jsonb(v_before),
        v_after,
        trim(p_reason),
        jsonb_build_object('source', 'admin_rides')
    );

    return v_after;
end;
$$;

revoke all on function public.admin_list_rides(text,timestamptz,timestamptz,text,text,boolean,boolean,integer,timestamptz,bigint)
from public, anon;
revoke all on function public.admin_get_ride_detail(bigint) from public, anon;
revoke all on function public.admin_ride_operations_metrics(timestamptz,timestamptz) from public, anon;
revoke all on function public.admin_override_ride_status(bigint,text,text) from public, anon;

grant execute on function public.admin_list_rides(text,timestamptz,timestamptz,text,text,boolean,boolean,integer,timestamptz,bigint)
to authenticated;
grant execute on function public.admin_get_ride_detail(bigint) to authenticated;
grant execute on function public.admin_ride_operations_metrics(timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_override_ride_status(bigint,text,text) to authenticated;

comment on function public.admin_list_rides(text,timestamptz,timestamptz,text,text,boolean,boolean,integer,timestamptz,bigint)
is 'Listado paginado y enriquecido del centro operativo Higo Viajes.';
comment on function public.admin_get_ride_detail(bigint)
is 'Detalle integral de un viaje: partes, ruta, precio, despacho, eventos e incidentes.';
comment on function public.admin_ride_operations_metrics(timestamptz,timestamptz)
is 'Métricas operativas de viajes; transactedVolume no representa ingreso de Higo.';

commit;

notify pgrst, 'reload schema';
