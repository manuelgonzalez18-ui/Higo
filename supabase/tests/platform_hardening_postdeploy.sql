-- Read-only post-deploy checks for the platform hardening migrations.
-- Expected result: every object_exists value is true, every violation count is
-- zero, directed dispatch remains disabled initially, event ingestion is
-- denied to anon but allowed to authenticated, and Pricing V4 is active.

select 'driver_membership_checkout' as object_name,
       to_regprocedure('public.driver_membership_checkout()') is not null as object_exists
union all
select 'register_membership_payment_v2',
       to_regprocedure('public.register_membership_payment_v2(uuid,uuid,text,text,text,text,numeric,numeric,date,text,jsonb)') is not null
union all
select 'register_membership_payment_v3',
       to_regprocedure('public.register_membership_payment_v3(uuid,uuid,text,text,text,text,numeric,numeric,date,text,jsonb)') is not null
union all
select 'higo_quote_ride_v3',
       to_regprocedure('public.higo_quote_ride_v3(double precision,double precision,double precision,double precision,text,text,numeric,integer,text,uuid,numeric)') is not null
union all
select 'create_ride_request_v4',
       to_regprocedure('public.create_ride_request_v4(uuid,text,text,double precision,double precision,double precision,double precision,text,text,numeric,jsonb,text,text,jsonb,text,numeric,text,numeric)') is not null
union all
select 'higo_quote_ride_v4',
       to_regprocedure('public.higo_quote_ride_v4(double precision,double precision,double precision,double precision,text,text,numeric,numeric,integer,text,uuid,numeric)') is not null
union all
select 'create_ride_request_v5',
       to_regprocedure('public.create_ride_request_v5(uuid,text,text,double precision,double precision,double precision,double precision,text,text,numeric,numeric,jsonb,text,text,jsonb,text,numeric,text,numeric)') is not null
union all
select 'admin_update_pricing_rollout',
       to_regprocedure('public.admin_update_pricing_rollout(text,numeric,numeric,text)') is not null
union all
select 'higo_guard_ride_coverage',
       to_regprocedure('public.higo_guard_ride_coverage()') is not null
union all
select 'driver_accept_ride_v2',
       to_regprocedure('public.driver_accept_ride_v2(bigint)') is not null
union all
select 'driver_complete_ride_v2',
       to_regprocedure('public.driver_complete_ride_v2(bigint)') is not null
union all
select 'driver_list_ride_offers',
       to_regprocedure('public.driver_list_ride_offers(integer)') is not null
union all
select 'higo_directed_offers_enabled',
       to_regprocedure('public.higo_directed_offers_enabled()') is not null
union all
select 'admin_set_platform_runtime_flags',
       to_regprocedure('public.admin_set_platform_runtime_flags(boolean)') is not null
union all
select 'track_platform_event',
       to_regprocedure('public.track_platform_event(text,text,text,text,jsonb,text,text,text)') is not null
union all
select 'admin_platform_funnel',
       to_regprocedure('public.admin_platform_funnel(integer)') is not null
union all
select 'ride_state_events',
       to_regclass('public.ride_state_events') is not null
union all
select 'ride_offers',
       to_regclass('public.ride_offers') is not null
union all
select 'platform_runtime_flags',
       to_regclass('public.platform_runtime_flags') is not null
union all
select 'pricing_rollout_config',
       to_regclass('public.pricing_rollout_config') is not null
union all
select 'pricing_quote_audit',
       to_regclass('public.pricing_quote_audit') is not null
union all
select 'platform_events',
       to_regclass('public.platform_events') is not null;

select 'duplicate_client_request_ids' as check_name, count(*) as violations
from (
    select user_id, client_request_id
    from public.rides
    where client_request_id is not null
    group by user_id, client_request_id
    having count(*) > 1
) duplicates
union all
select 'duplicate_promo_redemptions', count(*)
from (
    select ride_id
    from public.promo_redemptions
    group by ride_id
    having count(*) > 1
) duplicates
union all
select 'duplicate_ride_offers', count(*)
from (
    select ride_id, driver_id
    from public.ride_offers
    group by ride_id, driver_id
    having count(*) > 1
) duplicates
union all
select 'duplicate_pricing_audits', count(*)
from (
    select ride_id
    from public.pricing_quote_audit
    where ride_id is not null
    group by ride_id
    having count(*) > 1
) duplicates;

select
    event_object_table,
    trigger_name,
    action_timing,
    event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in (
      'trg_higo_guard_ride_coverage',
      'trg_higo_guard_ride_transition',
      'trg_higo_audit_ride_transition',
      'trg_higo_dispatch_new_ride',
      'trg_higo_sync_ride_offer_status'
  )
order by trigger_name;

select
    count(*) filter (where active) as active_plans,
    count(distinct public.higo_canonical_vehicle_type(vehicle_type)) filter (where active) as vehicle_types,
    count(*) filter (where active and period = 'weekly') as weekly_plans,
    count(*) filter (where active and period = 'monthly') as monthly_plans
from public.driver_membership_plans;

select
    directed_ride_offers,
    directed_ride_offers = false as safe_default,
    updated_at,
    updated_by
from public.platform_runtime_flags
where singleton;

select
    mode,
    mode = 'active' as prelaunch_ready,
    pilot_percentage,
    maximum_multiplier,
    maximum_multiplier <= 1.30 as conservative_cap
from public.pricing_rollout_config
where id = 1;

select
    vehicle_type,
    minimum_fare >= base as minimum_covers_base,
    per_minute >= 0 as time_rate_nonnegative,
    included_km >= 0 as included_km_nonnegative,
    free_wait_minutes >= 0 as free_wait_nonnegative,
    maximum_multiplier between 1 and 3 as multiplier_valid,
    pricing_version >= 4 as version_valid
from public.pricing_config
order by vehicle_type;

select
    has_function_privilege(
        'anon',
        'public.track_platform_event(text,text,text,text,jsonb,text,text,text)',
        'EXECUTE'
    ) as anon_can_track,
    has_function_privilege(
        'authenticated',
        'public.track_platform_event(text,text,text,text,jsonb,text,text,text)',
        'EXECUTE'
    ) as authenticated_can_track;
