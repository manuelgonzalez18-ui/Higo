-- Fix admin_get_ride_detail for production schemas where public.rides has no
-- updated_at column. The operational timeline now derives its last activity
-- from the most advanced lifecycle timestamp available on the ride.

begin;

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
            'updatedAt', coalesce(
                r.completed_at,
                r.cancelled_at,
                r.arrived_at_dropoff_at,
                r.started_at,
                r.arrived_at_pickup_at,
                r.accepted_at,
                r.created_at
            )
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

notify pgrst, 'reload schema';

commit;
