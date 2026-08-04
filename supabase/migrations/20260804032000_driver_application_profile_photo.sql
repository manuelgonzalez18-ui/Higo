-- Require and preserve a reviewed profile photo for every new Higo Driver.

begin;

alter table public.driver_application_documents
    drop constraint if exists driver_application_documents_document_type_check;

alter table public.driver_application_documents
    add constraint driver_application_documents_document_type_check
    check (document_type in (
        'profile_photo','identity','driver_license','vehicle_registration','rcv',
        'vehicle_photo','health_certificate','payment_details','other'
    ));

-- The application photo remains private while the request is reviewed. During
-- conversion, the approved image is copied to this public bucket and becomes
-- the driver's avatar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'driver-avatars',
    'driver-avatars',
    true,
    8388608,
    array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.admin_set_driver_application_status(
    p_application_code text,
    p_status text,
    p_reason text default null,
    p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_before public.driver_applications%rowtype;
    v_after public.driver_applications%rowtype;
    v_required_approved integer := 0;
    v_required_unapproved integer := 0;
begin
    perform public.higo_assert_admin('manage_drivers', true);

    select * into v_before
      from public.driver_applications
     where application_code = upper(trim(p_application_code))
     for update;

    if not found then
        raise exception 'driver_application_not_found' using errcode = 'P0002';
    end if;

    if not public.higo_driver_application_transition_allowed(v_before.status, p_status) then
        raise exception 'invalid_driver_application_transition:%->%', v_before.status, p_status
            using errcode = '22023';
    end if;

    if p_status = 'approved' and v_before.status <> 'approved' then
        select
            count(*) filter (where review_status = 'approved'),
            count(*) filter (where review_status <> 'approved')
          into v_required_approved, v_required_unapproved
          from (
              select distinct on (document_type)
                     document_type, review_status
                from public.driver_application_documents
               where application_id = v_before.id
                 and document_type in (
                     'profile_photo','identity','driver_license',
                     'vehicle_registration','rcv','vehicle_photo'
                 )
               order by document_type, created_at desc
          ) latest_required;

        if v_required_approved <> 6 or v_required_unapproved <> 0 then
            raise exception 'required_documents_not_approved' using errcode = '22023';
        end if;
    end if;

    if p_status in ('correction_requested','waitlist','rejected')
       and nullif(trim(coalesce(p_reason, '')), '') is null then
        raise exception 'status_reason_required' using errcode = '22023';
    end if;

    update public.driver_applications
       set status = p_status,
           status_reason = nullif(trim(coalesce(p_reason, '')), ''),
           last_status_changed_at = now(),
           last_status_changed_by = auth.uid()
     where id = v_before.id
     returning * into v_after;

    insert into public.driver_application_events(
        application_id, actor_type, actor_id, event_type, from_status, to_status, metadata
    ) values (
        v_before.id, 'admin', auth.uid(), 'status_changed', v_before.status, v_after.status,
        coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('reason', p_reason)
    );

    insert into public.admin_audit_log(
        actor_id, action, entity_type, entity_id, before_data, after_data, reason, metadata
    ) values (
        auth.uid(), 'driver_application.status_change', 'driver_application', v_before.application_code,
        jsonb_build_object('status', v_before.status),
        jsonb_build_object('status', v_after.status),
        p_reason,
        coalesce(p_metadata, '{}'::jsonb)
    );

    return to_jsonb(v_after);
end;
$$;

revoke all on function public.admin_set_driver_application_status(text,text,text,jsonb) from public, anon;
grant execute on function public.admin_set_driver_application_status(text,text,text,jsonb) to authenticated;

commit;
