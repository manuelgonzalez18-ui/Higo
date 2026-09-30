-- Additive preparation. Call higo_finalize_launch() ONLY after staging and schema preflight.
begin;
create table if not exists public.higo_launch_controls (
 singleton boolean primary key default true check(singleton),
 integrity_enforced boolean not null default false,
 activated_at timestamptz
);
alter table public.higo_launch_controls enable row level security;
revoke all on public.higo_launch_controls from public, anon, authenticated;
alter table public.rides add column if not exists rating integer;
alter table public.rides add column if not exists feedback text;
alter table public.rides add column if not exists cod_collected_at timestamptz;
alter table public.rides add column if not exists picked_up_at timestamptz;
alter table public.rides add column if not exists delivered_at timestamptz;
create table if not exists public.ride_evidence (
 id uuid primary key default gen_random_uuid(),
 ride_id bigint not null references public.rides(id),
 stage text not null check(stage in ('pickup','delivery')),
 object_path text not null unique,
 actor_id uuid not null,
 created_at timestamptz not null default now(),
 unique(ride_id, stage)
);
alter table public.ride_evidence enable row level security;
revoke all on public.ride_evidence from public, anon, authenticated;
grant select on public.ride_evidence to authenticated;
create policy ride_evidence_read on public.ride_evidence for select to authenticated using (
 exists(select 1 from public.rides r where r.id=ride_id and (r.user_id=auth.uid() or r.driver_id=auth.uid())) or public.higo_is_admin()
);
insert into public.higo_launch_controls(singleton) values(true) on conflict do nothing;

-- Bound reads even if an older permissive policy exists. Offer visibility is
-- further restricted by rides_directed_offers_restrictive when enabled.
alter table public.rides enable row level security;
grant select on public.rides to authenticated;
revoke all on public.rides from anon;
create policy rides_launch_read on public.rides for select to authenticated using (
 user_id=auth.uid() or driver_id=auth.uid() or public.higo_is_admin()
 or (status='requested' and driver_id is null and public.higo_current_user_is_driver())
);
create policy rides_launch_read_guard on public.rides as restrictive for select to authenticated using (
 user_id=auth.uid() or driver_id=auth.uid() or public.higo_is_admin()
 or (status='requested' and driver_id is null and public.higo_current_user_is_driver())
);

-- This legacy discovery RPC bypasses table RLS; keep the caller contract while
-- enforcing the same driver and directed-offer rules within the function.
create or replace function public.get_nearby_rides(
 driver_lat double precision,driver_lng double precision,
 radius_km double precision default 30,driver_vehicle_type text default 'standard'
)
returns setof public.rides language plpgsql stable security definer set search_path=public,pg_temp as $$
declare driver public.profiles%rowtype;
begin
 driver:=public.higo_assert_driver_operational();
 if driver_lat is null or driver_lng is null or abs(driver_lat)>90 or abs(driver_lng)>180
    or radius_km is null or radius_km<=0 or radius_km>30 then raise exception 'invalid_discovery_coordinates'; end if;
 return query select r.* from public.rides r
 where r.status='requested' and r.driver_id is null and r.created_at>=now()-interval '10 minutes'
   and public.higo_canonical_vehicle_type(r.ride_type)=public.higo_canonical_vehicle_type(driver.vehicle_type)
   and r.pickup_lat is not null and r.pickup_lng is not null
   and public.higo_haversine_km(driver_lat,driver_lng,r.pickup_lat,r.pickup_lng)<=radius_km
   and (not public.higo_directed_offers_enabled() or public.higo_driver_has_active_offer(r.id,driver.id))
 order by r.created_at desc limit 20;
end; $$;
revoke all on function public.get_nearby_rides(double precision,double precision,double precision,text) from public,anon;
grant execute on function public.get_nearby_rides(double precision,double precision,double precision,text) to authenticated;

create or replace function public.driver_register_pod_v1(p_ride_id bigint,p_stage text,p_object_path text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rides%rowtype; existing_path text; result jsonb;
begin
 perform public.higo_assert_driver_operational();
 select * into r from public.rides where id=p_ride_id and driver_id=auth.uid() for update;
 if not found or r.service_type <> 'delivery' then raise exception 'delivery_not_assigned' using errcode='42501'; end if;
 if p_stage is null or p_stage not in ('pickup','delivery') then raise exception 'invalid_pod_stage'; end if;
 select object_path into existing_path from public.ride_evidence where ride_id=r.id and stage=p_stage;
 if found then
   if existing_path=p_object_path then return to_jsonb(r); end if;
   raise exception 'evidence_already_confirmed';
 end if;
 if (p_stage='pickup' and r.status<>'accepted') or (p_stage='delivery' and r.status<>'arrived_at_dropoff') then raise exception 'invalid_pod_state'; end if;
 if p_object_path is null or p_object_path !~ ('^' || r.id || '/' || p_stage || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then raise exception 'invalid_pod_path'; end if;
 if not exists(select 1 from storage.objects o where bucket_id='delivery-pods' and name=p_object_path and coalesce(o.owner_id,o.owner::text)=auth.uid()::text) then raise exception 'pod_object_missing'; end if;
 insert into public.ride_evidence(ride_id,stage,object_path,actor_id) values(r.id,p_stage,p_object_path,auth.uid());
 update public.rides set pickup_pod_url=case when p_stage='pickup' then p_object_path else pickup_pod_url end,
 delivery_pod_url=case when p_stage='delivery' then p_object_path else delivery_pod_url end
 where id=r.id returning to_jsonb(rides) into result;
 perform public.higo_log_ride_event(r.id,r.status,r.status,'delivery.evidence_confirmed',jsonb_build_object('stage',p_stage));
 return result;
end; $$;
revoke all on function public.driver_register_pod_v1(bigint,text,text) from public,anon;
grant execute on function public.driver_register_pod_v1(bigint,text,text) to authenticated;

create or replace function public.driver_confirm_cod_v1(p_ride_id bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rides%rowtype;
begin
 perform public.higo_assert_driver_operational();
 select * into r from public.rides where id=p_ride_id and driver_id=auth.uid() for update;
 if not found then raise exception 'ride_not_assigned' using errcode='42501'; end if;
 if r.service_type<>'delivery' or coalesce(r.cod_amount,0)<=0 then raise exception 'invalid_cod_state'; end if;
 -- A retry after completion must preserve the original collection time.
 if r.cod_collected and r.cod_collected_at is not null then return to_jsonb(r); end if;
 if r.status<>'arrived_at_dropoff' then raise exception 'invalid_cod_state'; end if;
 update public.rides set cod_collected=true,cod_collected_at=coalesce(cod_collected_at,now()) where id=r.id returning * into r;
 perform public.higo_log_ride_event(r.id,r.status,r.status,'delivery.cod_confirmed','{}');
 return to_jsonb(r);
end; $$;
revoke all on function public.driver_confirm_cod_v1(bigint) from public,anon;
grant execute on function public.driver_confirm_cod_v1(bigint) to authenticated;

create or replace function public.passenger_rate_ride_v1(p_ride_id bigint,p_rating integer,p_feedback text default '')
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or p_rating is null or p_rating not between 1 and 5 or length(coalesce(p_feedback,''))>2000 then raise exception 'invalid_rating'; end if;
 update public.rides set rating=p_rating,feedback=p_feedback where id=p_ride_id and user_id=auth.uid() and status='completed';
 if not found then raise exception 'completed_ride_required' using errcode='42501'; end if;
end; $$;
revoke all on function public.passenger_rate_ride_v1(bigint,integer,text) from public,anon;
grant execute on function public.passenger_rate_ride_v1(bigint,integer,text) to authenticated;

create or replace function public.passenger_confirm_payment_v1(p_ride_id bigint,p_method text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rides%rowtype;
begin
 if p_method is null or p_method not in ('cash','pago_movil','transfer','direct','pm_banesco') then raise exception 'invalid_payment_method'; end if;
 select * into r from public.rides where id=p_ride_id and user_id=auth.uid() for update;
 if not found or r.status not in ('accepted','in_progress','arrived_at_dropoff','completed') then raise exception 'invalid_payment_state' using errcode='42501'; end if;
 update public.rides set payment_method=p_method where id=r.id;
 return public.ride_confirm_payment_v2(r.id);
end; $$;
revoke all on function public.passenger_confirm_payment_v1(bigint,text) from public,anon;
grant execute on function public.passenger_confirm_payment_v1(bigint,text) to authenticated;

create or replace function public.admin_ride_action_v1(p_ride_id bigint,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rides%rowtype; after_row public.rides%rowtype;
begin
 perform public.higo_assert_admin(case when p_action in ('confirm_payment','reset_payment') then 'manage_disputes' else 'manage_operations' end,true);
 if length(trim(coalesce(p_reason,'')))<5 or length(p_reason)>2000 then raise exception 'reason_required'; end if;
 select * into r from public.rides where id=p_ride_id for update;
 if not found then raise exception 'ride_not_found'; end if;
 if p_action='cancel' then
   if r.status not in ('requested','accepted','in_progress','arrived_at_dropoff') then raise exception 'invalid_ride_transition'; end if;
   update public.rides set status='cancelled',cancellation_reason=trim(p_reason) where id=r.id;
 elsif p_action='complete' then
   if r.status not in ('in_progress','arrived_at_dropoff') then raise exception 'invalid_ride_transition'; end if;
   update public.rides set status='completed' where id=r.id;
 elsif p_action='confirm_payment' then
   if r.status not in ('accepted','in_progress','arrived_at_dropoff','completed') then raise exception 'invalid_payment_state'; end if;
   update public.rides set payment_confirmed_by_user=true,payment_confirmed_by_driver=true,payment_confirmed_at=coalesce(payment_confirmed_at,now()) where id=r.id;
 elsif p_action='reset_payment' then
   update public.rides set payment_confirmed_by_user=false,payment_confirmed_by_driver=false,payment_confirmed_at=null,payment_reference=null where id=r.id;
 else raise exception 'invalid_admin_action';
 end if;
 select * into after_row from public.rides where id=r.id;
 -- Record the complete administrative decision independently of the generic
 -- transition event deduplicator, which can suppress adjacent RPC events.
 insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data,reason)
 values(auth.uid(),'ride.'||p_action,'ride',r.id::text,to_jsonb(r),to_jsonb(after_row),trim(p_reason));
 perform public.higo_log_ride_event(r.id,r.status,after_row.status,'admin.'||p_action,jsonb_build_object('reason',trim(p_reason)));
 return to_jsonb(after_row);
end; $$;
revoke all on function public.admin_ride_action_v1(bigint,text,text) from public,anon;
grant execute on function public.admin_ride_action_v1(bigint,text,text) to authenticated;

-- Import only historical objects owned by the assigned driver, never claim files.
insert into public.ride_evidence(ride_id,stage,object_path,actor_id,created_at)
select r.id,v.stage,v.path,r.driver_id,coalesce(o.created_at,now()) from public.rides r
cross join lateral(values('pickup',r.pickup_pod_url),('delivery',r.delivery_pod_url)) v(stage,path)
join storage.objects o on o.bucket_id='delivery-pods' and o.name=v.path
where r.service_type='delivery' and r.driver_id is not null
and coalesce(o.owner_id,o.owner::text)=r.driver_id::text
and v.path ~ ('^'||r.id||'/'||v.stage||'(/[0-9a-f-]{36})?\.(jpg|png|webp)$')
on conflict do nothing;

-- Invariants also protect direct writes and administrative mistakes.
create or replace function public.higo_delivery_evidence_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.service_type='delivery' and new.status is distinct from old.status then
   if new.status='in_progress' and coalesce(new.payer,new.delivery_info->>'payer')='sender'
      and not coalesce(old.payment_confirmed_by_driver,false) then
     raise exception 'sender_payment_confirmation_required';
   end if;
   if new.status='in_progress' then new.picked_up_at:=coalesce(new.picked_up_at,now()); end if;
   if new.status='completed' then new.delivered_at:=coalesce(new.delivered_at,now()); end if;
   if new.status in ('in_progress','arrived_at_dropoff','completed') and not exists (
     select 1 from public.ride_evidence e join storage.objects o on o.bucket_id='delivery-pods' and o.name=e.object_path
     where e.ride_id=new.id and e.stage='pickup' and e.object_path=new.pickup_pod_url and e.actor_id=new.driver_id and coalesce(o.owner_id,o.owner::text)=new.driver_id::text
   ) then raise exception 'pickup_pod_required'; end if;
   if new.status='completed' then
     if not exists(select 1 from public.ride_evidence e join storage.objects o on o.bucket_id='delivery-pods' and o.name=e.object_path where e.ride_id=new.id and e.stage='delivery' and e.object_path=new.delivery_pod_url and e.actor_id=new.driver_id and coalesce(o.owner_id,o.owner::text)=new.driver_id::text) then raise exception 'delivery_pod_required'; end if;
     if coalesce(new.cod_amount,0)>0 and not coalesce(new.cod_collected,false) then raise exception 'cod_confirmation_required'; end if;
   end if;
 end if;
 if old.pickup_pod_url is not null and new.pickup_pod_url is distinct from old.pickup_pod_url then raise exception 'evidence_immutable'; end if;
 if old.delivery_pod_url is not null and new.delivery_pod_url is distinct from old.delivery_pod_url then raise exception 'evidence_immutable'; end if;
 return new;
end; $$;
revoke all on function public.higo_delivery_evidence_guard() from public,anon,authenticated;
create trigger higo_delivery_evidence_guard before update on public.rides for each row execute function public.higo_delivery_evidence_guard();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('delivery-pods','delivery-pods',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists delivery_pods_select on storage.objects;
create policy delivery_pods_select on storage.objects for select to authenticated using(
 bucket_id='delivery-pods' and (public.higo_is_admin() or exists(select 1 from public.rides r where r.id::text=split_part(name,'/',1) and (r.driver_id=auth.uid() or r.user_id=auth.uid())))
);

-- Replace mutable legacy storage policy with stage/actor bounded INSERT and immutable objects.
drop policy if exists delivery_pods_insert on storage.objects;
drop policy if exists delivery_pods_update on storage.objects;
drop policy if exists delivery_pods_delete on storage.objects;
create policy delivery_pods_launch_insert on storage.objects for insert to authenticated with check(
 bucket_id='delivery-pods' and name ~ '^[0-9]+/(pickup|delivery|claims)/[0-9a-f-]{36}\.(jpg|png|webp)$'
 and exists(select 1 from public.rides r where r.id::text=split_part(name,'/',1) and r.service_type='delivery'
 and ((r.driver_id=auth.uid() and ((split_part(name,'/',2)='pickup' and r.status='accepted') or (split_part(name,'/',2)='delivery' and r.status='arrived_at_dropoff')))
 or (r.user_id=auth.uid() and split_part(name,'/',2)='claims')))
);
create policy delivery_pods_launch_insert_guard on storage.objects as restrictive for insert to authenticated with check(
 bucket_id<>'delivery-pods' or (name ~ '^[0-9]+/(pickup|delivery|claims)/[0-9a-f-]{36}\.(jpg|png|webp)$'
 and exists(select 1 from public.rides r where r.id::text=split_part(name,'/',1) and r.service_type='delivery'
 and ((r.driver_id=auth.uid() and ((split_part(name,'/',2)='pickup' and r.status='accepted') or (split_part(name,'/',2)='delivery' and r.status='arrived_at_dropoff')))
 or (r.user_id=auth.uid() and split_part(name,'/',2)='claims')))
));
create policy delivery_pods_read_guard on storage.objects as restrictive for select to authenticated using(
 bucket_id<>'delivery-pods' or public.higo_is_admin() or exists(
   select 1 from public.rides r where r.id::text=split_part(name,'/',1) and (r.driver_id=auth.uid() or r.user_id=auth.uid())
 )
);
create policy delivery_pods_no_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'delivery-pods') with check(bucket_id<>'delivery-pods');
create policy delivery_pods_no_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'delivery-pods');

-- Compatibility-safe additions: deployed tracking schema must be verified first.
create table if not exists public.delivery_tracking_tokens (
 token uuid primary key default gen_random_uuid(),ride_id bigint not null references public.rides(id),created_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '7 days')
);
alter table public.delivery_tracking_tokens enable row level security;
alter table public.delivery_tracking_tokens add column if not exists revoked_at timestamptz;
create index if not exists delivery_tracking_tokens_ride_idx on public.delivery_tracking_tokens(ride_id);
revoke all on public.delivery_tracking_tokens from public,anon,authenticated;
-- Table-level REVOKE does not clear historical column grants.
do $$ declare c record; begin
 for c in select attname from pg_attribute where attrelid='public.delivery_tracking_tokens'::regclass and attnum>0 and not attisdropped loop
   execute format('revoke insert (%I), update (%I), select (%I), references (%I) on public.delivery_tracking_tokens from public,anon,authenticated',c.attname,c.attname,c.attname,c.attname);
 end loop;
end; $$;
grant select on public.delivery_tracking_tokens to authenticated;
grant insert(ride_id) on public.delivery_tracking_tokens to authenticated;
drop policy if exists delivery_tracking_tokens_insert on public.delivery_tracking_tokens;
drop policy if exists delivery_tracking_tokens_select on public.delivery_tracking_tokens;
create policy delivery_tracking_tokens_insert on public.delivery_tracking_tokens for insert to authenticated with check(
 exists(select 1 from public.rides r where r.id=ride_id and r.service_type='delivery' and r.user_id=auth.uid())
);
create policy delivery_tracking_tokens_select on public.delivery_tracking_tokens for select to authenticated using(
 exists(select 1 from public.rides r where r.id=ride_id and (r.user_id=auth.uid() or r.driver_id=auth.uid())) or public.higo_is_admin()
);
create policy delivery_tracking_tokens_insert_guard on public.delivery_tracking_tokens as restrictive for insert to authenticated with check(
 exists(select 1 from public.rides r where r.id=ride_id and r.service_type='delivery' and r.user_id=auth.uid())
);
create policy delivery_tracking_tokens_read_guard on public.delivery_tracking_tokens as restrictive for select to authenticated using(
 exists(select 1 from public.rides r where r.id=ride_id and (r.user_id=auth.uid() or r.driver_id=auth.uid())) or public.higo_is_admin()
);
create or replace function public.get_public_tracking(p_token uuid)
returns table(status text,service_type text,pickup text,dropoff text,picked_up_at timestamptz,arrived_at_dropoff_at timestamptz,delivered_at timestamptz,driver_display_name text,driver_lat numeric,driver_lng numeric,delivery_pod_url text)
language sql stable security definer set search_path=public,pg_temp as $$
 select r.status,r.service_type,r.pickup,r.dropoff,
 r.picked_up_at,r.arrived_at_dropoff_at,
 coalesce(r.delivered_at,r.completed_at),split_part(trim(p.full_name),' ',1),
 case when r.status in ('accepted','in_progress','arrived_at_dropoff') then p.curr_lat::numeric end,
 case when r.status in ('accepted','in_progress','arrived_at_dropoff') then p.curr_lng::numeric end,
 case when r.status='completed' then r.delivery_pod_url end
 from public.delivery_tracking_tokens t join public.rides r on r.id=t.ride_id left join public.profiles p on p.id=r.driver_id
 where t.token=p_token and t.revoked_at is null and t.expires_at>now() and r.service_type='delivery'
 and (r.status<>'completed' or coalesce(r.delivered_at,r.completed_at,r.created_at)+interval '24 hours'>now())
 limit 1;
$$;
revoke all on function public.get_public_tracking(uuid) from public;
grant execute on function public.get_public_tracking(uuid) to anon,authenticated,service_role;

create or replace function public.revoke_tracking_token_v1(p_token uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.delivery_tracking_tokens t set revoked_at=now()
 where t.token=p_token and exists(select 1 from public.rides r where r.id=t.ride_id and r.user_id=auth.uid());
 if not found then raise exception 'tracking_not_owned' using errcode='42501'; end if;
end; $$;
revoke all on function public.revoke_tracking_token_v1(uuid) from public,anon;
grant execute on function public.revoke_tracking_token_v1(uuid) to authenticated;
commit;
