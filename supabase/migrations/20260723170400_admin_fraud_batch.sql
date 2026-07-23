create or replace function public.admin_get_fraud_signals_v2()
returns table(
    subject_type text,
    subject_id text,
    signal text,
    severity text,
    metadata jsonb,
    computed_at timestamptz,
    subject_name text,
    subject_phone text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    perform public.higo_assert_admin('manage_operations');
    return query
    select
        f.subject_type::text,
        f.subject_id::text,
        f.signal::text,
        f.severity::text,
        f.metadata,
        f.computed_at,
        p.full_name,
        p.phone
    from public.fraud_signals f
    left join public.profiles p
      on f.subject_type in ('passenger','driver')
     and p.id::text = f.subject_id::text
    order by
        case f.severity when 'high' then 1 when 'medium' then 2 else 3 end,
        f.computed_at desc;
end;
$$;

grant execute on function public.admin_get_fraud_signals_v2() to authenticated;
