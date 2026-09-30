begin;
-- The historical fixture has no wallet view; the reviewed live schema does.
do $$begin
 if to_regclass('public.wallet_balances') is not null then
  alter view public.wallet_balances set (security_invoker=true);
  revoke all on public.wallet_balances from public,anon;
  grant select on public.wallet_balances to authenticated;
 end if;
end $$;
-- A materialized view cannot apply per-reader RLS. Administrative RPCs enforce
-- their own permission checks and read this relation as the function owner.
revoke all on public.fraud_signals from public,anon,authenticated;
do $$declare f record; begin
 for f in select p.oid::regprocedure as signature
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (left(p.proname,6)='admin_'
    or p.proname in ('get_fraud_signals','refresh_fraud_signals'))
 loop
  execute format('revoke all on function %s from public, anon',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
 -- Explicit list of reviewed helpers reported by the security advisor.
 for f in select p.oid::regprocedure as signature
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
   'assign_referral_code','gen_referral_code','higo_canonical_vehicle_type',
   'higo_driver_application_transition_allowed','higo_haversine_km',
   'higo_membership_status','higo_pricing_bucket','higo_touch_updated_at',
   'tg_driver_documents_resubmit','tg_pricing_rules_touch','tg_user_preferences_touch',
   'touch_membership_plans','touch_pricing_config','validate_cod_collection')
 loop
  execute format('alter function %s set search_path=pg_catalog,public,extensions,pg_temp',f.signature);
 end loop;
end $$;
commit;
