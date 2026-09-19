begin;
create table public.ride_route_quotes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 route jsonb not null,
 distance_km numeric not null check(distance_km>0 and distance_km<=2000),
 duration_min numeric not null check(duration_min>0 and duration_min<=2880),
 vehicle_type text not null check(vehicle_type in ('moto','standard','van')),
 service_type text not null check(service_type in ('ride','delivery')),
 promo_code text,
 quote jsonb not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default(now()+interval '5 minutes'),
 consumed_ride_id bigint references public.rides(id),
 request_id uuid
);
create index ride_route_quotes_user_expiry_idx on public.ride_route_quotes(user_id,expires_at);
alter table public.ride_route_quotes enable row level security;
revoke all on public.ride_route_quotes from public,anon,authenticated;
grant select on public.ride_route_quotes to authenticated;
create policy ride_route_quote_owner on public.ride_route_quotes for select to authenticated using(user_id=auth.uid());

create or replace function public.higo_store_route_quote(
 p_user_id uuid,p_route jsonb,p_distance_km numeric,p_duration_min numeric,p_vehicle_type text,p_service_type text,p_promo_code text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.ride_route_quotes%rowtype; priced jsonb; point jsonb;
begin
 if p_user_id is null or p_distance_km is null or p_duration_min is null or p_distance_km<=0 or p_distance_km>2000 or p_duration_min<=0 or p_duration_min>2880 then raise exception 'invalid_route_metrics'; end if;
 if p_vehicle_type is null or p_service_type is null or p_vehicle_type not in ('moto','standard','van') or p_service_type not in ('ride','delivery') then raise exception 'invalid_service'; end if;
 if coalesce(jsonb_typeof(p_route),'null')<>'object' or coalesce(jsonb_typeof(p_route->'stops'),'null')<>'array' then raise exception 'invalid_stops'; end if;
 if jsonb_array_length(p_route->'stops')>5 then raise exception 'invalid_stops'; end if;
 for point in select p_route->'pickupCoords' union all select p_route->'dropoffCoords' union all select value from jsonb_array_elements(p_route->'stops') loop
   if coalesce(jsonb_typeof(point),'null')<>'object'
      or coalesce(jsonb_typeof(point->'lat'),'null')<>'number'
      or coalesce(jsonb_typeof(point->'lng'),'null')<>'number' then raise exception 'invalid_coordinates'; end if;
   if abs((point->>'lat')::numeric)>90 or abs((point->>'lng')::numeric)>180 then raise exception 'invalid_coordinates'; end if;
 end loop;
 if not exists(select 1 from public.profiles where id=p_user_id and role in ('passenger','user') and archived_at is null and suspended_at is null) then raise exception 'passenger_role_required' using errcode='42501'; end if;
 priced := public.higo_quote_ride_v4(
 (p_route->'pickupCoords'->>'lat')::double precision,(p_route->'pickupCoords'->>'lng')::double precision,
 (p_route->'dropoffCoords'->>'lat')::double precision,(p_route->'dropoffCoords'->>'lng')::double precision,
 p_vehicle_type,p_service_type,p_distance_km,p_duration_min,jsonb_array_length(p_route->'stops'),p_promo_code,p_user_id,null);
 -- V4 retains legacy bounds derived from straight-line distance. Until the
 -- pricing model explicitly supports longer detours, fail closed instead of
 -- silently charging for less distance/time than the trusted provider returned.
 -- Tolerances only cover the historical 3/2 decimal output rounding.
 if priced->>'distanceKm' is null or priced->>'durationMin' is null
    or abs((priced->>'distanceKm')::numeric-p_distance_km)>0.001
    or abs((priced->>'durationMin')::numeric-p_duration_min)>0.01 then
   raise exception 'route_outside_pricing_bounds';
 end if;
 insert into public.ride_route_quotes(user_id,route,distance_km,duration_min,vehicle_type,service_type,promo_code,quote)
 values(p_user_id,p_route,p_distance_km,p_duration_min,p_vehicle_type,p_service_type,p_promo_code,priced) returning * into q;
 return priced||jsonb_build_object('quoteId',q.id,'expiresAt',q.expires_at);
end; $$;
revoke all on function public.higo_store_route_quote(uuid,jsonb,numeric,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.higo_store_route_quote(uuid,jsonb,numeric,numeric,text,text,text) to service_role;

create or replace function public.create_ride_from_quote(
 p_quote_id uuid,p_client_request_id uuid,p_pickup text,p_dropoff text,
 p_passenger_phone text default null,p_delivery_info jsonb default null,p_payer text default null,
 p_cod_amount numeric default null,p_terms_version text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.ride_route_quotes%rowtype; result jsonb; current_quote jsonb; canonical_delivery jsonb;
begin
 if auth.uid() is null or p_client_request_id is null then raise exception 'authentication_and_request_id_required' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and role in ('passenger','user') and archived_at is null and suspended_at is null) then raise exception 'passenger_role_required' using errcode='42501'; end if;
 -- Serialize creation per passenger, including retries with a new request ID.
 perform pg_advisory_xact_lock(hashtextextended('ride-create:'||auth.uid()::text,0));
 select jsonb_build_object('rideId',r.id,'price',r.price,'status',r.status,'quote',r.pricing_snapshot,'idempotentReplay',true)
 into result from public.rides r where r.user_id=auth.uid() and r.client_request_id=p_client_request_id;
 if found then return result; end if;
 if exists(select 1 from public.rides where user_id=auth.uid() and status in ('requested','accepted','in_progress','arrived_at_dropoff')) then raise exception 'active_ride_exists'; end if;
 select * into q from public.ride_route_quotes where id=p_quote_id and user_id=auth.uid() for update;
 if not found then raise exception 'quote_not_owned' using errcode='42501'; end if;
 if q.consumed_ride_id is not null then raise exception 'quote_already_consumed'; end if;
 if q.expires_at<=clock_timestamp() then raise exception 'quote_expired'; end if;
 if length(trim(coalesce(p_pickup,'')))=0 or length(trim(coalesce(p_dropoff,'')))=0 or length(p_pickup)>500 or length(p_dropoff)>500 then raise exception 'invalid_addresses'; end if;
 if coalesce(p_cod_amount,0)<0 or coalesce(p_cod_amount,0)>10000 then raise exception 'invalid_cod_amount'; end if;
 if q.service_type='ride' and (p_delivery_info is not null or p_payer is not null or coalesce(p_cod_amount,0)>0) then raise exception 'delivery_payload_not_allowed'; end if;
 if q.service_type='delivery' and (p_payer is null or p_payer not in ('sender','receiver')) then raise exception 'invalid_payer'; end if;
 if q.service_type='delivery' then
   if p_delivery_info is null or jsonb_typeof(p_delivery_info)<>'object' or octet_length(p_delivery_info::text)>16000 then raise exception 'invalid_delivery_info'; end if;
   canonical_delivery := p_delivery_info || jsonb_build_object('payer',p_payer,'cod_amount',coalesce(p_cod_amount,0));
 end if;
 -- Hold the promotion lock across re-quotation and redemption.
 if q.promo_code is not null then
   perform 1 from public.promo_codes where upper(code)=upper(trim(q.promo_code)) for update;
 end if;
 current_quote:=public.higo_quote_ride_v4(
 (q.route->'pickupCoords'->>'lat')::double precision,(q.route->'pickupCoords'->>'lng')::double precision,
 (q.route->'dropoffCoords'->>'lat')::double precision,(q.route->'dropoffCoords'->>'lng')::double precision,
 q.vehicle_type,q.service_type,q.distance_km,q.duration_min,jsonb_array_length(q.route->'stops'),q.promo_code,auth.uid(),null);
 if current_quote->>'distanceKm' is null or current_quote->>'durationMin' is null
    or abs((current_quote->>'distanceKm')::numeric-q.distance_km)>0.001
    or abs((current_quote->>'durationMin')::numeric-q.duration_min)>0.01 then
   raise exception 'route_outside_pricing_bounds';
 end if;
 if (current_quote->>'finalPrice')::numeric is distinct from (q.quote->>'finalPrice')::numeric then raise exception 'quote_changed'; end if;
 result:=public.create_ride_request_v5(
 p_client_request_id,p_pickup,p_dropoff,
 (q.route->'pickupCoords'->>'lat')::double precision,(q.route->'pickupCoords'->>'lng')::double precision,
 (q.route->'dropoffCoords'->>'lat')::double precision,(q.route->'dropoffCoords'->>'lng')::double precision,
 q.vehicle_type,q.service_type,q.distance_km,q.duration_min,q.route->'stops',q.promo_code,
 p_passenger_phone,canonical_delivery,p_payer,p_cod_amount,p_terms_version,null);
 if (result->>'price')::numeric is distinct from (q.quote->>'finalPrice')::numeric then raise exception 'quote_changed'; end if;
 update public.ride_route_quotes set consumed_ride_id=(result->>'rideId')::bigint,request_id=p_client_request_id where id=q.id;
 return result;
end; $$;
revoke all on function public.create_ride_from_quote(uuid,uuid,text,text,text,jsonb,text,numeric,text) from public,anon;
grant execute on function public.create_ride_from_quote(uuid,uuid,text,text,text,jsonb,text,numeric,text) to authenticated;

-- The owner invokes this after schema preflight + same-SHA staging tests. Not exposed to clients.
create or replace function public.higo_finalize_launch()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare f record; c record;
begin
 revoke insert,update,delete on public.rides from public,anon,authenticated;
 for c in select attname from pg_attribute where attrelid='public.rides'::regclass and attnum>0 and not attisdropped loop
   execute format('revoke insert (%I), update (%I) on public.rides from public, anon, authenticated',c.attname,c.attname);
 end loop;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_ride_request_v2','create_ride_request_v3','create_ride_request_v4','create_ride_request_v5','apply_promo_code') loop
   execute format('revoke all on function %s from public, anon, authenticated',f.signature);
 end loop;
 update public.higo_launch_controls set integrity_enforced=true,activated_at=now() where singleton;
end; $$;
revoke all on function public.higo_finalize_launch() from public,anon,authenticated,service_role;
commit;
