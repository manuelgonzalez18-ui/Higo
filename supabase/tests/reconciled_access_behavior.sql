-- Run only on the restored, disposable schema; all fixtures are rolled back.
begin;
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000009701'),
 ('00000000-0000-4000-8000-000000009702'),
 ('00000000-0000-4000-8000-000000009703');
insert into public.profiles(id,full_name,role) values
 ('00000000-0000-4000-8000-000000009701','Synthetic wallet owner','passenger'),
 ('00000000-0000-4000-8000-000000009702','Synthetic other owner','passenger'),
 ('00000000-0000-4000-8000-000000009703','Synthetic operations admin','admin');
insert into public.admin_staff_roles(user_id,staff_role,active) values
 ('00000000-0000-4000-8000-000000009703','operations',true);
insert into public.wallet_movements(user_id,type,amount) values
 ('00000000-0000-4000-8000-000000009701','manual_adjustment',10),
 ('00000000-0000-4000-8000-000000009702','manual_adjustment',25);
set session authorization authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009701","role":"authenticated"}',false);
do $$begin
 if (select count(*) from public.wallet_balances)<>1
   or (select balance from public.wallet_balances where user_id=auth.uid())<>10 then
  raise exception 'wallet_view_exposed_foreign_balance';
 end if;
 begin
  perform 1 from public.fraud_signals;
  raise exception 'client_can_read_fraud_relation';
 exception when insufficient_privilege then null; end;
 begin
  perform public.admin_get_fraud_signals_v2();
  raise exception 'passenger_can_read_fraud_rpc';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009703","role":"authenticated","aal":"aal2"}',false);
-- The administrative consumer still works after revoking direct view access.
select count(*) from public.admin_get_fraud_signals_v2();
reset session authorization;
set session authorization anon;
select set_config('request.jwt.claims','{"role":"anon"}',false);
do $$begin
 begin perform 1 from public.wallet_balances;
  raise exception 'anonymous_wallet_read_allowed';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.fraud_signals;
  raise exception 'anonymous_fraud_read_allowed';
 exception when insufficient_privilege then null; end;
 if has_function_privilege(current_user,'public.admin_get_fraud_signals_v2()','execute') then
  raise exception 'anonymous_admin_rpc_permission';
 end if;
end $$;
reset session authorization;
rollback;
select 'reconciled_access_behavior' as test_suite,true as passed;
