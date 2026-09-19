-- Disposable database only. Exercises the final contract as non-owner roles.
begin;
-- Model the Storage API transaction context so its statement-level SQL-delete
-- safeguard does not mask Higo's own RLS immutability assertions. This flag
-- grants no table privileges and lasts only until the final rollback.
-- https://supabase.com/blog/supabase-storage-performance-security-reliability-updates
set local storage.allow_delete_query = 'true';
insert into public.profiles(id,full_name,role,status,subscription_status,vehicle_type,subscription_override_until)
values
 ('00000000-0000-4000-8000-000000009101','Launch passenger','passenger','offline','suspended',null,null),
 ('00000000-0000-4000-8000-000000009102','Stranger','passenger','offline','suspended',null,null),
 ('00000000-0000-4000-8000-000000009103','Assigned driver','driver','online','active','standard',now()+interval '1 day'),
 ('00000000-0000-4000-8000-000000009104','Suspended driver','driver','online','suspended','standard',null);
insert into public.profiles(id,full_name,role,status,subscription_status) values
 ('00000000-0000-4000-8000-000000009105','Operations admin','admin','offline','suspended'),
 ('00000000-0000-4000-8000-000000009106','Read only admin','admin','offline','suspended');
insert into public.admin_staff_roles(user_id,staff_role,active) values
 ('00000000-0000-4000-8000-000000009105','operations',true),
 ('00000000-0000-4000-8000-000000009106','viewer',true);
update public.platform_runtime_flags set directed_ride_offers=false where singleton;

create table public.launch_test_values(name text primary key,value text);
revoke all on public.launch_test_values from public,anon,authenticated;
grant select,insert on public.launch_test_values to authenticated,service_role;
insert into public.launch_test_values values('quote',public.higo_store_route_quote(
 '00000000-0000-4000-8000-000000009101',
 '{"pickupCoords":{"lat":10.4653,"lng":-65.9711},"dropoffCoords":{"lat":10.475,"lng":-65.98},"stops":[]}',
 2.5,8,'standard','delivery',null)->>'quoteId');
-- The trusted backend is still required to send valid, bounded route data.
do $$begin
 begin
  perform public.higo_store_route_quote('00000000-0000-4000-8000-000000009101',
    '{"pickupCoords":{"lat":91,"lng":-65},"dropoffCoords":{"lat":10,"lng":-65},"stops":[]}',2,8,'standard','ride');
  raise exception 'invalid_latitude_accepted';
 exception when others then if sqlerrm<>'invalid_coordinates' then raise; end if; end;
 begin
  perform public.higo_store_route_quote('00000000-0000-4000-8000-000000009101',
    '{"pickupCoords":{"lat":10,"lng":-65},"dropoffCoords":{"lat":10,"lng":-65},"stops":[{"lat":10}]}',2,8,'standard','ride');
  raise exception 'malformed_stop_accepted';
 exception when others then if sqlerrm<>'invalid_coordinates' then raise; end if; end;
 begin
  perform public.higo_store_route_quote('00000000-0000-4000-8000-000000009101','{}','NaN',8,'standard','ride');
  raise exception 'nonfinite_distance_accepted';
 exception when others then if sqlerrm<>'invalid_route_metrics' then raise; end if; end;
 begin
  perform public.higo_store_route_quote('00000000-0000-4000-8000-000000009101',
    '{"pickupCoords":{"lat":10.4653,"lng":-65.9711},"dropoffCoords":{"lat":10.475,"lng":-65.98},"stops":[{"lat":10.5,"lng":-65.95}]}',
    25,45,'standard','ride');
  raise exception 'provider_detour_silently_underpriced';
 exception when others then if sqlerrm<>'route_outside_pricing_bounds' then raise; end if; end;
 begin
  perform public.higo_store_route_quote('00000000-0000-4000-8000-000000009101',
    '{"pickupCoords":{"lat":10.4653,"lng":-65.9711},"dropoffCoords":{"lat":10.475,"lng":-65.98},"stops":[]}',
    2.5,300,'standard','ride');
  raise exception 'provider_duration_silently_underpriced';
 exception when others then if sqlerrm<>'route_outside_pricing_bounds' then raise; end if; end;
end $$;
select public.higo_finalize_launch();
-- A broad legacy storage policy must not widen launch evidence visibility.
create policy launch_test_legacy_storage_read on storage.objects for select to authenticated using(true);
create policy launch_test_legacy_tracking_read on public.delivery_tracking_tokens for select to authenticated using(true);
create policy launch_test_legacy_tracking_insert on public.delivery_tracking_tokens for insert to authenticated with check(true);
set session authorization authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009101","role":"authenticated"}',false);
do $$declare q uuid; created jsonb; replay jsonb; begin
 select value::uuid into q from public.launch_test_values where name='quote';
 created:=public.create_ride_from_quote(q,'00000000-0000-4000-8000-000000009201','Origin','Destination',null,'{"payer":"receiver"}', 'sender',12,'v1');
 replay:=public.create_ride_from_quote(q,'00000000-0000-4000-8000-000000009201','Changed','Changed');
 if created->>'rideId'<>replay->>'rideId' or not (replay->>'idempotentReplay')::boolean then raise exception 'idempotency_failed'; end if;
 insert into public.launch_test_values values('ride',created->>'rideId');
 begin
   update public.rides set price=0.01 where id=(created->>'rideId')::bigint;
   raise exception 'direct_price_write_allowed';
 exception when insufficient_privilege then null; end;
 begin
   perform public.higo_store_route_quote(auth.uid(),'{}',1,1,'moto','ride');
   raise exception 'client_quote_forgery_allowed';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from public.rides where id=(created->>'rideId')::bigint and delivery_info->>'payer'<>'sender') then raise exception 'payer_not_canonical'; end if;
 begin
  perform public.create_ride_from_quote(q,'00000000-0000-4000-8000-000000009202','Origin','Destination');
  raise exception 'second_active_ride_allowed';
 exception when others then if sqlerrm<>'active_ride_exists' then raise; end if; end;
 begin
  update public.rides set status='completed' where id=(created->>'rideId')::bigint;
  raise exception 'direct_status_write_allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.create_ride_request_v5('00000000-0000-4000-8000-000000009299','Forged','Forged',10.4653,-65.9711,10.475,-65.98,'standard');
  raise exception 'legacy_quote_bypass_allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.higo_finalize_launch();
  raise exception 'client_cutover_allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009102","role":"authenticated"}',false);
do $$begin
 if exists(select 1 from public.rides where id=(select value::bigint from public.launch_test_values where name='ride')) then raise exception 'stranger_read_allowed'; end if;
 if exists(select 1 from public.ride_route_quotes) then raise exception 'stranger_quote_read_allowed'; end if;
 begin
  perform public.get_nearby_rides(10.4653,-65.9711,30,'standard');
  raise exception 'passenger_discovery_allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.create_ride_from_quote((select value::uuid from public.launch_test_values where name='quote'),
   '00000000-0000-4000-8000-000000009203','Origin','Destination');
  raise exception 'foreign_quote_consumption_allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.driver_confirm_cod_v1((select value::bigint from public.launch_test_values where name='ride'));
  raise exception 'stranger_cod_allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.passenger_cancel_ride_v2((select value::bigint from public.launch_test_values where name='ride'),'not mine');
  raise exception 'stranger_cancel_allowed';
 exception when others then if sqlerrm not in ('ride_not_found','ride_not_owned') and sqlstate<>'42501' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009104","role":"authenticated"}',false);
do $$begin
 begin
  perform public.driver_accept_ride_v2((select value::bigint from public.launch_test_values where name='ride'));
  raise exception 'membership_bypass_allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009103","role":"authenticated"}',false);
do $$declare rid bigint; pickup_path text; delivery_path text; cod_at timestamptz; result jsonb; begin
 select value::bigint into rid from public.launch_test_values where name='ride';
 if not exists(select 1 from public.get_nearby_rides(10.4653,-65.9711,30,'moto') where id=rid) then
   raise exception 'driver_discovery_did_not_use_profile_vehicle';
 end if;
 perform public.driver_accept_ride_v2(rid);
 begin
  perform public.driver_confirm_cod_v1(rid);
  raise exception 'cod_before_arrival_allowed';
 exception when others then if sqlerrm<>'invalid_cod_state' then raise; end if; end;
 pickup_path:=rid||'/pickup/00000000-0000-4000-8000-000000009301.jpg';
 delivery_path:=rid||'/delivery/00000000-0000-4000-8000-000000009302.jpg';
 begin
   perform public.driver_register_pod_v1(rid,'pickup',pickup_path);
   raise exception 'missing_pod_accepted';
 exception when others then if sqlerrm<>'pod_object_missing' then raise; end if; end;
 insert into storage.objects(bucket_id,name,owner,owner_id)
 values('delivery-pods',rid||'/pickup/00000000-0000-4000-8000-000000009399.jpg','00000000-0000-4000-8000-000000009102','00000000-0000-4000-8000-000000009102');
 begin
   perform public.driver_register_pod_v1(rid,'pickup',rid||'/pickup/00000000-0000-4000-8000-000000009399.jpg');
   raise exception 'foreign_owned_pod_accepted';
 exception when others then if sqlerrm<>'pod_object_missing' then raise; end if; end;
 insert into storage.objects(bucket_id,name,owner,owner_id) values('delivery-pods',pickup_path,auth.uid(),auth.uid()::text);
 perform public.driver_register_pod_v1(rid,'pickup',pickup_path);
 perform public.driver_register_pod_v1(rid,'pickup',pickup_path); -- identical retry
 begin
  perform public.driver_start_ride_v2(rid);
  raise exception 'sender_payment_bypass';
 exception when others then if sqlerrm<>'sender_payment_confirmation_required' then raise; end if; end;
 perform public.ride_confirm_payment_v2(rid);
 perform public.driver_start_ride_v2(rid);
 if (select picked_up_at from public.rides where id=rid) is null then raise exception 'pickup_timestamp_missing'; end if;
 perform public.driver_mark_dropoff_arrival_v2(rid);
 begin
   perform public.driver_complete_ride_v2(rid);
   raise exception 'completion_without_pod_allowed';
 exception when others then if sqlerrm not like '%delivery_pod_required%' then raise; end if; end;
 insert into storage.objects(bucket_id,name,owner,owner_id) values('delivery-pods',delivery_path,auth.uid(),auth.uid()::text);
 perform public.driver_register_pod_v1(rid,'delivery',delivery_path);
 begin
   perform public.driver_complete_ride_v2(rid);
   raise exception 'completion_without_cod_allowed';
 exception when others then if sqlerrm not like '%cod_%' then raise; end if; end;
 result:=public.driver_confirm_cod_v1(rid);
 cod_at:=(result->>'cod_collected_at')::timestamptz;
 if cod_at is null then raise exception 'cod_timestamp_missing'; end if;
 perform public.driver_complete_ride_v2(rid);
 result:=public.driver_confirm_cod_v1(rid);
 if (result->>'cod_collected_at')::timestamptz is distinct from cod_at then raise exception 'cod_retry_changed_timestamp'; end if;
 if (result->>'delivered_at') is null then raise exception 'delivery_timestamp_missing'; end if;
 update storage.objects set metadata='{"overwritten":true}' where bucket_id='delivery-pods' and name=delivery_path;
 if found then raise exception 'confirmed_evidence_mutable'; end if;
 delete from storage.objects where bucket_id='delivery-pods' and name=delivery_path;
 if found then raise exception 'confirmed_evidence_deletable'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009101","role":"authenticated"}',false);
insert into public.delivery_tracking_tokens(ride_id) select value::bigint from public.launch_test_values where name='ride';
insert into public.launch_test_values select 'token',token::text from public.delivery_tracking_tokens where ride_id=(select value::bigint from public.launch_test_values where name='ride');
do $$begin
 begin
  insert into public.delivery_tracking_tokens(ride_id,expires_at) values((select value::bigint from public.launch_test_values where name='ride'),now()+interval '100 years');
  raise exception 'tracking_expiry_forgery_allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.admin_ride_action_v1((select value::bigint from public.launch_test_values where name='ride'),'confirm_payment','Not an administrator');
  raise exception 'passenger_admin_action_allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009102","role":"authenticated"}',false);
do $$begin
 if exists(select 1 from storage.objects where bucket_id='delivery-pods') then raise exception 'legacy_policy_exposed_pod'; end if;
 if exists(select 1 from public.delivery_tracking_tokens) then raise exception 'legacy_policy_exposed_tracking'; end if;
 begin
  insert into public.delivery_tracking_tokens(ride_id) select value::bigint from public.launch_test_values where name='ride';
  raise exception 'stranger_tracking_creation_allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009106","role":"authenticated"}',false);
do $$begin
 begin
  perform public.admin_ride_action_v1((select value::bigint from public.launch_test_values where name='ride'),'confirm_payment','Viewer has no mutation permission');
  raise exception 'viewer_admin_action_allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009105","role":"authenticated"}',false);
select public.admin_ride_action_v1((select value::bigint from public.launch_test_values where name='ride'),'confirm_payment','Verified bilateral payment');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009101","role":"authenticated"}',false);
do $$declare t uuid; begin
 select value::uuid into t from public.launch_test_values where name='token';
 if (select count(*) from public.get_public_tracking(t))<>1 then raise exception 'public_tracking_unavailable'; end if;
 perform public.revoke_tracking_token_v1(t);
 if exists(select 1 from public.get_public_tracking(t)) then raise exception 'revocation_failed'; end if;
end $$;
reset session authorization;
do $$begin
 if not exists(select 1 from public.admin_audit_log
   where action='ride.confirm_payment' and entity_id=(select value from public.launch_test_values where name='ride')
   and before_data->>'payment_confirmed_by_user'='false' and after_data->>'payment_confirmed_by_user'='true'
   and reason='Verified bilateral payment' and actor_id='00000000-0000-4000-8000-000000009105') then
   raise exception 'admin_payment_audit_missing';
 end if;
end $$;
insert into public.delivery_tracking_tokens(ride_id,token)
select value::bigint,'00000000-0000-4000-8000-000000009501' from public.launch_test_values where name='ride';
-- Test unauthenticated tracking and the independent 24-hour delivery deadline.
set session authorization anon;
select set_config('request.jwt.claims','{"role":"anon"}',false);
do $$begin
 if (select count(*) from public.get_public_tracking('00000000-0000-4000-8000-000000009501'))<>1 then raise exception 'anonymous_tracking_failed'; end if;
 begin
  perform public.get_nearby_rides(10.4653,-65.9711,30,'standard');
  raise exception 'anonymous_discovery_allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset session authorization;
update public.rides set delivered_at=now()-interval '25 hours'
where id=(select value::bigint from public.launch_test_values where name='ride');
set session authorization anon;
do $$begin
 if exists(select 1 from public.get_public_tracking('00000000-0000-4000-8000-000000009501')) then raise exception 'tracking_delivery_ttl_failed'; end if;
end $$;
reset session authorization;
insert into public.launch_test_values values('expired_quote',public.higo_store_route_quote(
 '00000000-0000-4000-8000-000000009101',
 '{"pickupCoords":{"lat":10.4653,"lng":-65.9711},"dropoffCoords":{"lat":10.475,"lng":-65.98},"stops":[]}',
 2.5,8,'standard','ride',null)->>'quoteId');
update public.ride_route_quotes set expires_at=now()-interval '1 second'
where id=(select value::uuid from public.launch_test_values where name='expired_quote');
set session authorization authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009101","role":"authenticated"}',false);
do $$begin
 begin
  perform public.create_ride_from_quote((select value::uuid from public.launch_test_values where name='expired_quote'),
    '00000000-0000-4000-8000-000000009204','Origin','Destination');
  raise exception 'expired_quote_accepted';
 exception when others then if sqlerrm<>'quote_expired' then raise; end if; end;
end $$;
reset session authorization;
insert into public.rides(id,user_id,pickup,dropoff,price,ride_type,status,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng)
values(900009999,'00000000-0000-4000-8000-000000009102','Origin','Destination',3,'standard','requested',10.4653,-65.9711,10.475,-65.98);
-- Existing requested rows without an addressed offer must disappear once the
-- runtime gate turns on, including through the old SECURITY DEFINER RPC.
update public.platform_runtime_flags set directed_ride_offers=true where singleton;
set session authorization authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009103","role":"authenticated"}',false);
do $$begin
 if exists(select 1 from public.get_nearby_rides(10.4653,-65.9711,30,'standard') where id=900009999) then
   raise exception 'directed_discovery_bypass';
 end if;
end $$;
reset session authorization;
set session authorization authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009105","role":"authenticated"}',false);
select public.admin_ride_action_v1(900009999,'cancel','Passenger requested support cancellation');
reset session authorization;
do $$begin
 if not exists(select 1 from public.admin_audit_log where action='ride.cancel' and entity_id='900009999'
   and before_data->>'status'='requested' and after_data->>'status'='cancelled'
   and reason='Passenger requested support cancellation') then raise exception 'admin_status_audit_incorrect'; end if;
 if exists(select 1 from public.ride_state_events where ride_id=900009999 and event_type='admin.cancel'
   and (from_status<>'requested' or to_status<>'cancelled')) then raise exception 'admin_event_status_incorrect'; end if;
end $$;
rollback;
select 'launch_behavior' as test_suite,true as passed;
