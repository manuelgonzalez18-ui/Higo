alter table public.promo_codes
    add column if not exists funding_source text not null default 'higo'
        check (funding_source in ('higo','sponsor','driver_campaign')),
    add column if not exists sponsor_name text,
    add column if not exists budget_amount numeric(12,2),
    add column if not exists spent_amount numeric(12,2) not null default 0,
    add column if not exists archived_at timestamptz,
    add column if not exists archived_by uuid;

create or replace function public.admin_save_promo(p_id bigint, p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id bigint;
    v_source text := coalesce(p_payload->>'funding_source','higo');
    v_budget numeric := nullif(p_payload->>'budget_amount','')::numeric;
    v_before jsonb;
begin
    perform public.higo_assert_admin('manage_promos', true);
    if public.higo_admin_role() <> 'super_admin' then raise exception 'super_admin_required'; end if;
    if coalesce(trim(p_payload->>'code'),'')='' then raise exception 'promo_code_required'; end if;
    if v_source not in ('higo','sponsor','driver_campaign') then raise exception 'invalid_funding_source'; end if;
    if v_budget is null or v_budget <= 0 then raise exception 'promo_budget_required'; end if;
    if v_source='sponsor' and coalesce(trim(p_payload->>'sponsor_name'),'')='' then raise exception 'sponsor_name_required'; end if;

    if p_id is null then
        insert into public.promo_codes(
            code, description, discount_type, discount_value, max_uses, max_uses_per_user,
            min_ride_amount, expires_at, active, funding_source, sponsor_name, budget_amount
        ) values (
            upper(trim(p_payload->>'code')), nullif(trim(p_payload->>'description'),''),
            coalesce(p_payload->>'discount_type','percent'), coalesce((p_payload->>'discount_value')::numeric,0),
            nullif(p_payload->>'max_uses','')::integer, coalesce((p_payload->>'max_uses_per_user')::integer,1),
            coalesce((p_payload->>'min_ride_amount')::numeric,0), nullif(p_payload->>'expires_at','')::timestamptz,
            coalesce((p_payload->>'active')::boolean,true), v_source, nullif(trim(p_payload->>'sponsor_name'),''), v_budget
        ) returning id into v_id;
        insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,after_data)
        select auth.uid(),'promo.create','promo_code',v_id::text,to_jsonb(p) from public.promo_codes p where p.id=v_id;
    else
        select to_jsonb(p) into v_before from public.promo_codes p where id=p_id for update;
        if v_before is null then raise exception 'promo_not_found'; end if;
        update public.promo_codes set
            description=nullif(trim(p_payload->>'description'),''),
            discount_type=coalesce(p_payload->>'discount_type',discount_type),
            discount_value=coalesce((p_payload->>'discount_value')::numeric,discount_value),
            max_uses=nullif(p_payload->>'max_uses','')::integer,
            max_uses_per_user=coalesce((p_payload->>'max_uses_per_user')::integer,1),
            min_ride_amount=coalesce((p_payload->>'min_ride_amount')::numeric,0),
            expires_at=nullif(p_payload->>'expires_at','')::timestamptz,
            active=coalesce((p_payload->>'active')::boolean,active),
            funding_source=v_source,
            sponsor_name=nullif(trim(p_payload->>'sponsor_name'),''),
            budget_amount=v_budget
        where id=p_id returning id into v_id;
        insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data)
        select auth.uid(),'promo.update','promo_code',v_id::text,v_before,to_jsonb(p) from public.promo_codes p where p.id=v_id;
    end if;
    return v_id;
end;
$$;

create or replace function public.admin_archive_promo(p_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_before jsonb;
begin
    perform public.higo_assert_admin('manage_promos', true);
    if public.higo_admin_role() <> 'super_admin' then raise exception 'super_admin_required'; end if;
    if coalesce(trim(p_reason),'')='' then raise exception 'archive_reason_required'; end if;
    select to_jsonb(p) into v_before from public.promo_codes p where id=p_id for update;
    if v_before is null then raise exception 'promo_not_found'; end if;
    update public.promo_codes set active=false, archived_at=now(), archived_by=auth.uid() where id=p_id;
    insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data,reason)
    select auth.uid(),'promo.archive','promo_code',p_id::text,v_before,to_jsonb(p),trim(p_reason) from public.promo_codes p where p.id=p_id;
end;
$$;

grant execute on function public.admin_save_promo(bigint,jsonb) to authenticated;
grant execute on function public.admin_archive_promo(bigint,text) to authenticated;
