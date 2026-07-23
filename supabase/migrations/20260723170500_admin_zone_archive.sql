create or replace function public.admin_archive_zone(p_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_before jsonb;
begin
    perform public.higo_assert_admin('manage_zones', true);
    if coalesce(trim(p_reason), '') = '' then
        raise exception 'archive_reason_required';
    end if;

    select to_jsonb(z) into v_before
    from public.coverage_zones z
    where z.id = p_id
    for update;

    if v_before is null then
        raise exception 'zone_not_found';
    end if;

    update public.coverage_zones
    set active = false
    where id = p_id;

    insert into public.admin_audit_log(
        actor_id, action, entity_type, entity_id, before_data, after_data, reason
    )
    select auth.uid(), 'zone.archive', 'coverage_zones', p_id::text,
           v_before, to_jsonb(z), trim(p_reason)
    from public.coverage_zones z
    where z.id = p_id;
end;
$$;

grant execute on function public.admin_archive_zone(bigint,text) to authenticated;
