-- Pricing V4: tarifa mínima + distancia + tiempo estimado + multiplicador controlado.
--
-- Despliegue seguro:
--   * El modo inicial es "shadow": calcula el modelo nuevo pero cobra el precio
--     legado. Esto permite medir el impacto antes de activarlo.
--   * per_minute inicia en 0 y minimum_fare inicia igual a base, por lo que la
--     migración no aumenta precios por sí sola.
--   * En pilot/active el nuevo precio nunca baja el cálculo legado y el
--     multiplicador queda limitado por configuración (1.30x por defecto).

begin;

-- ---------------------------------------------------------------------------
-- Parámetros comerciales por vehículo
-- ---------------------------------------------------------------------------

alter table public.pricing_config
    add column if not exists minimum_fare numeric(12,2),
    add column if not exists per_minute numeric(12,4),
    add column if not exists included_km numeric(12,3),
    add column if not exists free_wait_minutes numeric(12,2),
    add column if not exists maximum_multiplier numeric(6,3),
    add column if not exists pricing_version integer,
    add column if not exists effective_from timestamptz;

update public.pricing_config
set minimum_fare = coalesce(minimum_fare, base),
    per_minute = coalesce(per_minute, 0),
    included_km = coalesce(included_km, 1),
    free_wait_minutes = coalesce(free_wait_minutes, 3),
    maximum_multiplier = coalesce(maximum_multiplier, 1.30),
    pricing_version = coalesce(pricing_version, 4),
    effective_from = coalesce(effective_from, now());

alter table public.pricing_config
    alter column minimum_fare set default 0,
    alter column minimum_fare set not null,
    alter column per_minute set default 0,
    alter column per_minute set not null,
    alter column included_km set default 1,
    alter column included_km set not null,
    alter column free_wait_minutes set default 3,
    alter column free_wait_minutes set not null,
    alter column maximum_multiplier set default 1.30,
    alter column maximum_multiplier set not null,
    alter column pricing_version set default 4,
    alter column pricing_version set not null,
    alter column effective_from set default now(),
    alter column effective_from set not null;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'pricing_config_minimum_fare_nonnegative'
          and conrelid = 'public.pricing_config'::regclass
    ) then
        alter table public.pricing_config
            add constraint pricing_config_minimum_fare_nonnegative check (minimum_fare >= 0);
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'pricing_config_per_minute_nonnegative'
          and conrelid = 'public.pricing_config'::regclass
    ) then
        alter table public.pricing_config
            add constraint pricing_config_per_minute_nonnegative check (per_minute >= 0);
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'pricing_config_included_km_bounds'
          and conrelid = 'public.pricing_config'::regclass
    ) then
        alter table public.pricing_config
            add constraint pricing_config_included_km_bounds check (included_km >= 0 and included_km <= 20);
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'pricing_config_free_wait_bounds'
          and conrelid = 'public.pricing_config'::regclass
    ) then
        alter table public.pricing_config
            add constraint pricing_config_free_wait_bounds check (free_wait_minutes >= 0 and free_wait_minutes <= 60);
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'pricing_config_multiplier_bounds'
          and conrelid = 'public.pricing_config'::regclass
    ) then
        alter table public.pricing_config
            add constraint pricing_config_multiplier_bounds check (maximum_multiplier >= 1 and maximum_multiplier <= 3);
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Control de rollout: legacy -> shadow -> pilot -> active
-- ---------------------------------------------------------------------------

create table if not exists public.pricing_rollout_config (
    id smallint primary key default 1 check (id = 1),
    mode text not null default 'shadow' check (mode in ('legacy','shadow','pilot','active')),
    pilot_percentage numeric(5,2) not null default 0 check (pilot_percentage >= 0 and pilot_percentage <= 100),
    maximum_multiplier numeric(6,3) not null default 1.30 check (maximum_multiplier >= 1 and maximum_multiplier <= 3),
    notes text,
    updated_by uuid references public.profiles(id) on delete set null,
    updated_at timestamptz not null default now()
);

insert into public.pricing_rollout_config(id, mode, pilot_percentage, maximum_multiplier, notes)
values (1, 'shadow', 0, 1.30, 'Pricing V4 desplegado en modo sombra; no cambia el precio cobrado.')
on conflict (id) do nothing;

alter table public.pricing_rollout_config enable row level security;
drop policy if exists pricing_rollout_authenticated_read on public.pricing_rollout_config;
create policy pricing_rollout_authenticated_read
on public.pricing_rollout_config for select
to authenticated
using (true);

drop policy if exists pricing_rollout_admin_write on public.pricing_rollout_config;
create policy pricing_rollout_admin_write
on public.pricing_rollout_config for all
to authenticated
using (public.higo_is_admin())
with check (public.higo_is_admin());

grant select on public.pricing_rollout_config to authenticated;
revoke insert, update, delete on public.pricing_rollout_config from anon;

-- ---------------------------------------------------------------------------
-- Snapshot auditable e inmutable por viaje
-- ---------------------------------------------------------------------------

alter table public.rides
    add column if not exists quoted_duration_min numeric(12,2),
    add column if not exists pricing_version integer,
    add column if not exists pricing_model text,
    add column if not exists pricing_multiplier numeric(6,3),
    add column if not exists pricing_multiplier_reason text,
    add column if not exists pricing_base_amount numeric(12,2),
    add column if not exists pricing_distance_amount numeric(12,2),
    add column if not exists pricing_time_amount numeric(12,2),
    add column if not exists pricing_stops_amount numeric(12,2),
    add column if not exists pricing_extras_amount numeric(12,2),
    add column if not exists pricing_minimum_fare numeric(12,2);

create table if not exists public.pricing_quote_audit (
    id uuid primary key default gen_random_uuid(),
    ride_id bigint references public.rides(id) on delete cascade,
    user_id uuid references public.profiles(id) on delete set null,
    rollout_mode text not null,
    model_applied boolean not null default false,
    pilot_bucket integer,
    vehicle_type text not null,
    service_type text not null,
    distance_km numeric(12,3),
    duration_min numeric(12,2),
    legacy_subtotal numeric(12,2) not null,
    model_subtotal numeric(12,2) not null,
    charged_subtotal numeric(12,2) not null,
    quote jsonb not null,
    created_at timestamptz not null default now(),
    unique (ride_id)
);
create index if not exists idx_pricing_quote_audit_created
    on public.pricing_quote_audit(created_at desc);
create index if not exists idx_pricing_quote_audit_mode
    on public.pricing_quote_audit(rollout_mode, model_applied, created_at desc);

alter table public.pricing_quote_audit enable row level security;
drop policy if exists pricing_quote_audit_admin_read on public.pricing_quote_audit;
create policy pricing_quote_audit_admin_read
on public.pricing_quote_audit for select
to authenticated
using (public.higo_is_admin());

drop policy if exists pricing_quote_audit_passenger_read on public.pricing_quote_audit;
create policy pricing_quote_audit_passenger_read
on public.pricing_quote_audit for select
to authenticated
using (user_id = auth.uid());

grant select on public.pricing_quote_audit to authenticated;
revoke insert, update, delete on public.pricing_quote_audit from anon, authenticated;

create or replace function public.higo_pricing_bucket(p_user_id uuid)
returns integer
language sql
immutable
as $$
    select case
        when p_user_id is null then 100
        else mod(abs(hashtext(p_user_id::text))::bigint, 100)::integer
    end;
$$;

-- ---------------------------------------------------------------------------
-- Cotización V4
-- ---------------------------------------------------------------------------

create or replace function public.higo_quote_ride_v4(
    p_pickup_lat double precision,
    p_pickup_lng double precision,
    p_dropoff_lat double precision,
    p_dropoff_lng double precision,
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
    v_type text := public.higo_canonical_vehicle_type(p_vehicle_type);
    v_legacy jsonb;
    v_result jsonb;
    v_base numeric;
    v_per_km numeric;
    v_per_minute numeric;
    v_delivery_fee numeric;
    v_stop_fee numeric;
    v_minimum_fare numeric;
    v_included_km numeric;
    v_vehicle_max numeric;
    v_pricing_version integer;
    v_distance numeric;
    v_duration numeric;
    v_distance_amount numeric;
    v_time_amount numeric;
    v_stops_amount numeric;
    v_extras_amount numeric;
    v_pre_multiplier numeric;
    v_multiplier numeric;
    v_multiplier_reason text;
    v_legacy_subtotal numeric;
    v_model_subtotal numeric;
    v_charged_subtotal numeric;
    v_mode text := 'shadow';
    v_pilot_percentage numeric := 0;
    v_rollout_max numeric := 1.30;
    v_bucket integer := public.higo_pricing_bucket(p_user_id);
    v_model_applied boolean := false;
    v_stops integer := greatest(0, least(coalesce(p_stops_count, 0), 5));
    v_duration_cap numeric;
begin
    -- Cotización legada sin promoción: fuente segura para distancia, surge y
    -- piso de compatibilidad con clientes existentes.
    v_legacy := public.higo_quote_ride_v3(
        p_pickup_lat,
        p_pickup_lng,
        p_dropoff_lat,
        p_dropoff_lng,
        v_type,
        p_service_type,
        p_route_distance_km,
        v_stops,
        null,
        p_user_id,
        null
    );

    select
        coalesce(pc.base, 0),
        coalesce(pc.per_km, 0),
        coalesce(pc.per_minute, 0),
        coalesce(pc.delivery_fee, 0),
        coalesce(pc.stop_fee, 0),
        greatest(coalesce(pc.minimum_fare, pc.base, 0), coalesce(pc.base, 0)),
        greatest(0, coalesce(pc.included_km, 1)),
        greatest(1, coalesce(pc.maximum_multiplier, 1.30)),
        coalesce(pc.pricing_version, 4)
    into
        v_base, v_per_km, v_per_minute, v_delivery_fee, v_stop_fee,
        v_minimum_fare, v_included_km, v_vehicle_max, v_pricing_version
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
        v_per_minute := 0;
        v_minimum_fare := v_base;
        v_included_km := 1;
        v_vehicle_max := 1.30;
        v_pricing_version := 4;
    end if;

    select mode, pilot_percentage, maximum_multiplier
    into v_mode, v_pilot_percentage, v_rollout_max
    from public.pricing_rollout_config
    where id = 1;

    v_mode := coalesce(v_mode, 'shadow');
    v_pilot_percentage := greatest(0, least(coalesce(v_pilot_percentage, 0), 100));
    v_rollout_max := greatest(1, least(coalesce(v_rollout_max, 1.30), 3));

    v_distance := greatest(0, coalesce((v_legacy->>'distanceKm')::numeric, 0));

    -- El tiempo lo entrega el proveedor de rutas. Se limita para impedir que un
    -- cliente manipulado infle la cotización: máximo 30 min fijos + 12 min/km.
    v_duration_cap := greatest(30, v_distance * 12 + 30);
    v_duration := greatest(0, least(coalesce(p_route_duration_min, 0), v_duration_cap));

    v_multiplier := greatest(
        1,
        least(
            coalesce((v_legacy->>'surgeMultiplier')::numeric, 1),
            v_vehicle_max,
            v_rollout_max
        )
    );
    v_multiplier_reason := case when v_multiplier > 1 then 'regla_zona_horario' else 'tarifa_normal' end;

    v_distance_amount := round(greatest(0, v_distance - v_included_km) * v_per_km, 2);
    v_time_amount := round(v_duration * v_per_minute, 2);
    v_stops_amount := round(v_stops * v_stop_fee, 2);
    v_extras_amount := round(
        case when coalesce(p_service_type, 'ride') = 'delivery' then v_delivery_fee else 0 end,
        2
    );
    v_pre_multiplier := v_base + v_distance_amount + v_time_amount + v_stops_amount + v_extras_amount;
    v_model_subtotal := round(greatest(v_minimum_fare, v_pre_multiplier * v_multiplier), 2);
    v_legacy_subtotal := round(greatest(0, coalesce((v_legacy->>'subtotal')::numeric, 0)), 2);

    v_model_applied := case
        when v_mode = 'active' then true
        when v_mode = 'pilot' then v_bucket < v_pilot_percentage
        else false
    end;

    v_charged_subtotal := greatest(
        v_legacy_subtotal,
        case when v_model_applied then v_model_subtotal else v_legacy_subtotal end,
        greatest(0, coalesce(p_client_subtotal_floor, 0))
    );

    -- Reutiliza toda la validación transaccional de promociones de V3, pero
    -- usando el subtotal elegido por el rollout como piso no reducible.
    v_result := public.higo_quote_ride_v3(
        p_pickup_lat,
        p_pickup_lng,
        p_dropoff_lat,
        p_dropoff_lng,
        v_type,
        p_service_type,
        p_route_distance_km,
        v_stops,
        p_promo_code,
        p_user_id,
        v_charged_subtotal
    );

    return v_result || jsonb_build_object(
        'pricingVersion', v_pricing_version,
        'pricingModel', 'distance_time_minimum_v4',
        'rolloutMode', v_mode,
        'modelApplied', v_model_applied,
        'pilotBucket', v_bucket,
        'distanceKm', round(v_distance, 3),
        'durationMin', round(v_duration, 2),
        'durationCapped', coalesce(p_route_duration_min, 0) > v_duration,
        'base', round(v_base, 2),
        'perKm', v_per_km,
        'perMinute', v_per_minute,
        'includedKm', v_included_km,
        'minimumFare', round(v_minimum_fare, 2),
        'maximumMultiplier', least(v_vehicle_max, v_rollout_max),
        'distanceAmount', v_distance_amount,
        'timeAmount', v_time_amount,
        'stopsAmount', v_stops_amount,
        'extrasAmount', v_extras_amount,
        'surgeMultiplier', v_multiplier,
        'multiplierReason', v_multiplier_reason,
        'legacySubtotal', v_legacy_subtotal,
        'modelSubtotal', v_model_subtotal,
        'chargedSubtotal', round(v_charged_subtotal, 2),
        'generatedAt', now()
    );
end;
$$;

grant execute on function public.higo_quote_ride_v4(
    double precision,double precision,double precision,double precision,
    text,text,numeric,numeric,integer,text,uuid,numeric
) to authenticated;

-- ---------------------------------------------------------------------------
-- Creación V5: guarda el desglose que vio el pasajero
-- ---------------------------------------------------------------------------

create or replace function public.create_ride_request_v5(
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
    v_stops_count integer := 0;
    v_quote jsonb;
    v_created jsonb;
    v_ride_id bigint;
    v_replay boolean := false;
    v_result jsonb;
begin
    if v_user_id is null then
        raise exception 'authentication_required' using errcode = '42501';
    end if;

    if jsonb_typeof(coalesce(p_stops, '[]'::jsonb)) = 'array' then
        v_stops_count := jsonb_array_length(coalesce(p_stops, '[]'::jsonb));
    end if;

    v_quote := public.higo_quote_ride_v4(
        p_pickup_lat,
        p_pickup_lng,
        p_dropoff_lat,
        p_dropoff_lng,
        p_vehicle_type,
        p_service_type,
        p_route_distance_km,
        p_route_duration_min,
        v_stops_count,
        p_promo_code,
        v_user_id,
        p_client_subtotal_floor
    );

    if coalesce(trim(p_promo_code), '') <> ''
       and not coalesce((v_quote->>'promoValid')::boolean, false) then
        raise exception 'promo_invalid:%', coalesce(v_quote->>'promoError', 'unknown');
    end if;

    v_created := public.create_ride_request_v4(
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
        p_terms_version,
        (v_quote->>'chargedSubtotal')::numeric
    );

    v_ride_id := nullif(v_created->>'rideId', '')::bigint;
    v_replay := coalesce((v_created->>'idempotentReplay')::boolean, false);
    if v_ride_id is null then
        raise exception 'ride_creation_failed';
    end if;

    if not v_replay then
        update public.rides r
        set quoted_distance_km = (v_quote->>'distanceKm')::numeric,
            quoted_duration_min = (v_quote->>'durationMin')::numeric,
            pricing_version = (v_quote->>'pricingVersion')::integer,
            pricing_model = v_quote->>'pricingModel',
            pricing_multiplier = (v_quote->>'surgeMultiplier')::numeric,
            pricing_multiplier_reason = v_quote->>'multiplierReason',
            pricing_base_amount = (v_quote->>'base')::numeric,
            pricing_distance_amount = (v_quote->>'distanceAmount')::numeric,
            pricing_time_amount = (v_quote->>'timeAmount')::numeric,
            pricing_stops_amount = (v_quote->>'stopsAmount')::numeric,
            pricing_extras_amount = (v_quote->>'extrasAmount')::numeric,
            pricing_minimum_fare = (v_quote->>'minimumFare')::numeric,
            price_before_discount = (v_quote->>'subtotal')::numeric,
            discount_amount = (v_quote->>'discount')::numeric,
            price = (v_quote->>'finalPrice')::numeric,
            pricing_snapshot = v_quote
        where r.id = v_ride_id
          and r.user_id = v_user_id;

        insert into public.pricing_quote_audit(
            ride_id, user_id, rollout_mode, model_applied, pilot_bucket,
            vehicle_type, service_type, distance_km, duration_min,
            legacy_subtotal, model_subtotal, charged_subtotal, quote
        ) values (
            v_ride_id,
            v_user_id,
            v_quote->>'rolloutMode',
            coalesce((v_quote->>'modelApplied')::boolean, false),
            nullif(v_quote->>'pilotBucket', '')::integer,
            v_quote->>'vehicleType',
            v_quote->>'serviceType',
            (v_quote->>'distanceKm')::numeric,
            (v_quote->>'durationMin')::numeric,
            (v_quote->>'legacySubtotal')::numeric,
            (v_quote->>'modelSubtotal')::numeric,
            (v_quote->>'chargedSubtotal')::numeric,
            v_quote
        ) on conflict (ride_id) do nothing;
    end if;

    select jsonb_build_object(
        'rideId', r.id,
        'price', r.price,
        'status', r.status,
        'quote', r.pricing_snapshot,
        'idempotentReplay', v_replay
    )
    into v_result
    from public.rides r
    where r.id = v_ride_id
      and r.user_id = v_user_id;

    return v_result;
end;
$$;

grant execute on function public.create_ride_request_v5(
    uuid,text,text,double precision,double precision,double precision,
    double precision,text,text,numeric,numeric,jsonb,text,text,jsonb,text,
    numeric,text,numeric
) to authenticated;

-- ---------------------------------------------------------------------------
-- Administración segura del rollout
-- ---------------------------------------------------------------------------

create or replace function public.admin_update_pricing_rollout(
    p_mode text,
    p_pilot_percentage numeric default 0,
    p_maximum_multiplier numeric default 1.30,
    p_notes text default null
)
returns public.pricing_rollout_config
language plpgsql
security definer
set search_path = public
as $$
declare
    v_result public.pricing_rollout_config%rowtype;
begin
    if not public.higo_is_admin() then
        raise exception 'admin_required' using errcode = '42501';
    end if;
    if p_mode not in ('legacy','shadow','pilot','active') then
        raise exception 'invalid_pricing_rollout_mode';
    end if;
    if p_pilot_percentage < 0 or p_pilot_percentage > 100 then
        raise exception 'invalid_pilot_percentage';
    end if;
    if p_maximum_multiplier < 1 or p_maximum_multiplier > 3 then
        raise exception 'invalid_maximum_multiplier';
    end if;

    update public.pricing_rollout_config
    set mode = p_mode,
        pilot_percentage = p_pilot_percentage,
        maximum_multiplier = p_maximum_multiplier,
        notes = nullif(trim(p_notes), ''),
        updated_by = auth.uid(),
        updated_at = now()
    where id = 1
    returning * into v_result;

    if to_regclass('public.admin_audit_log') is not null then
        insert into public.admin_audit_log(
            actor_id, action, entity_type, entity_id, after_data, metadata
        ) values (
            auth.uid(),
            'pricing.rollout_updated',
            'pricing_rollout_config',
            '1',
            to_jsonb(v_result),
            jsonb_build_object('source', 'admin_pricing')
        );
    end if;

    return v_result;
end;
$$;

grant execute on function public.admin_update_pricing_rollout(text,numeric,numeric,text)
to authenticated;

commit;
