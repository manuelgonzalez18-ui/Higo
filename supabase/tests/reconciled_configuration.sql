-- Synthetic configuration for an empty, disposable database. Never production.
begin;
do $$begin
 if current_setting('higo.disposable_database',true) is distinct from '1' then
  raise exception 'disposable_database_required';
 end if;
 if exists(select 1 from public.profiles) or exists(select 1 from public.rides)
    or exists(select 1 from public.pricing_config) then
  raise exception 'synthetic_configuration_requires_empty_database';
 end if;
end $$;
insert into public.pricing_config(vehicle_type,base,per_km,delivery_fee,wait_per_min,stop_fee)
values ('moto',1,0.25,0.5,0.05,0.5),('standard',1.5,0.4,1.5,0.08,1),('van',1.7,0.6,2,0.1,1);
insert into public.coverage_zones(name,center_lat,center_lng,radius_km)
values ('Synthetic launch test zone',10.4653,-65.9711,35);
insert into public.platform_runtime_flags(singleton,directed_ride_offers) values(true,false);
insert into public.pricing_rollout_config(id,mode,notes) values(1,'active','Synthetic CI configuration');
-- MFA enrollment is tested separately through Auth; these SQL assertions exercise
-- admin staff permissions without pretending to complete an Auth MFA challenge.
insert into public.admin_security_settings(singleton,require_mfa) values(true,false);
refresh materialized view public.fraud_signals;
commit;
