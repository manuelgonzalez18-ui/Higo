-- Core business counts come from transactional facts, not client telemetry.
-- Client events remain useful for intent/drop-off measurements only.

begin;

create or replace function public.admin_platform_funnel(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
    v_since timestamptz;
begin
    perform public.higo_assert_admin('view_analytics');
    v_since := now() - make_interval(days => v_days);

    return jsonb_build_object(
        'days', v_days,
        'rideRequestStarted', (
            select count(*)
            from public.platform_events
            where event_name = 'ride.request_started'
              and created_at >= v_since
        ),
        'rideRequested', (
            select count(*)
            from public.rides
            where created_at >= v_since
        ),
        'rideAccepted', (
            select count(*)
            from public.rides
            where accepted_at is not null
              and created_at >= v_since
        ),
        'rideCompleted', (
            select count(*)
            from public.rides
            where status = 'completed'
              and created_at >= v_since
        ),
        'rideCancelled', (
            select count(*)
            from public.rides
            where status = 'cancelled'
              and created_at >= v_since
        ),
        'membershipCheckoutViewed', (
            select count(*)
            from public.platform_events
            where event_name = 'membership.checkout_viewed'
              and created_at >= v_since
        ),
        'membershipPaymentValidated', (
            select count(*)
            from public.driver_memberships
            where voided_at is null
              and paid_at >= v_since
        ),
        'medianAcceptSeconds', (
            select percentile_cont(0.5) within group (
                order by extract(epoch from (r.accepted_at - r.created_at))
            )
            from public.rides r
            where r.accepted_at is not null
              and r.created_at >= v_since
        ),
        'p90AcceptSeconds', (
            select percentile_cont(0.9) within group (
                order by extract(epoch from (r.accepted_at - r.created_at))
            )
            from public.rides r
            where r.accepted_at is not null
              and r.created_at >= v_since
        ),
        'unassignedOlderThan10Minutes', (
            select count(*)
            from public.rides r
            where r.status = 'requested'
              and r.created_at < now() - interval '10 minutes'
        ),
        'generatedAt', now()
    );
end;
$$;

commit;
