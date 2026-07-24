-- Race-safe claims for applicant document uploads and administrative conversion.

begin;

alter table public.driver_application_upload_tokens
    add column if not exists claim_id uuid,
    add column if not exists claimed_at timestamptz;

alter table public.driver_applications
    add column if not exists conversion_claim_id uuid,
    add column if not exists conversion_claimed_at timestamptz,
    add column if not exists conversion_claimed_by uuid;

create or replace function public.higo_claim_driver_application_upload_token(
    p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_token public.driver_application_upload_tokens%rowtype;
    v_application public.driver_applications%rowtype;
    v_claim_id uuid := gen_random_uuid();
begin
    select * into v_token
      from public.driver_application_upload_tokens
     where token_hash = p_token_hash
       and used_at is null
       and expires_at > now()
       and (claimed_at is null or claimed_at < now() - interval '15 minutes')
     for update;

    if not found then return null; end if;

    select * into v_application
      from public.driver_applications
     where id = v_token.application_id
     for update;

    if not found or v_application.status not in ('documents_requested','correction_requested') then
        return null;
    end if;

    update public.driver_application_upload_tokens
       set claim_id = v_claim_id,
           claimed_at = now(),
           last_used_at = now()
     where id = v_token.id;

    return to_jsonb(v_application) || jsonb_build_object(
        'upload_claim_id', v_claim_id,
        'upload_token_id', v_token.id,
        'upload_expires_at', v_token.expires_at
    );
end;
$$;

create or replace function public.higo_release_driver_application_upload_token(
    p_token_hash text,
    p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    update public.driver_application_upload_tokens
       set claim_id = null,
           claimed_at = null
     where token_hash = p_token_hash
       and claim_id = p_claim_id
       and used_at is null;
    get diagnostics v_count = row_count;
    return v_count = 1;
end;
$$;

create or replace function public.higo_complete_driver_application_upload(
    p_token_hash text,
    p_claim_id uuid,
    p_documents_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_token public.driver_application_upload_tokens%rowtype;
    v_before public.driver_applications%rowtype;
    v_after public.driver_applications%rowtype;
begin
    if coalesce(p_documents_count, 0) < 1 then
        raise exception 'no_documents' using errcode = '22023';
    end if;

    select * into v_token
      from public.driver_application_upload_tokens
     where token_hash = p_token_hash
       and claim_id = p_claim_id
       and claimed_at >= now() - interval '15 minutes'
       and used_at is null
       and expires_at > now()
     for update;

    if not found then
        raise exception 'invalid_or_expired_upload_claim' using errcode = '28000';
    end if;

    select * into v_before
      from public.driver_applications
     where id = v_token.application_id
     for update;

    if not found then
        raise exception 'driver_application_not_found' using errcode = 'P0002';
    end if;
    if v_before.status not in ('documents_requested','correction_requested') then
        raise exception 'documents_not_expected' using errcode = '22023';
    end if;

    update public.driver_application_upload_tokens
       set used_at = now(),
           last_used_at = now(),
           claim_id = null,
           claimed_at = null
     where id = v_token.id;

    update public.driver_applications
       set status = 'documents_submitted',
           status_reason = null,
           last_status_changed_at = now(),
           last_status_changed_by = null
     where id = v_before.id
     returning * into v_after;

    insert into public.driver_application_events(
        application_id, actor_type, event_type, from_status, to_status, metadata
    ) values (
        v_before.id, 'applicant', 'documents_submitted', v_before.status,
        'documents_submitted', jsonb_build_object('documents_count', p_documents_count)
    );

    return to_jsonb(v_after);
end;
$$;

create or replace function public.admin_claim_driver_application_conversion(
    p_application_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_application public.driver_applications%rowtype;
    v_claim_id uuid := gen_random_uuid();
begin
    perform public.higo_assert_admin('manage_drivers', true);

    select * into v_application
      from public.driver_applications
     where application_code = upper(trim(p_application_code))
     for update;

    if not found then
        raise exception 'driver_application_not_found' using errcode = 'P0002';
    end if;

    if v_application.status = 'converted' or v_application.converted_user_id is not null then
        return to_jsonb(v_application) || jsonb_build_object('already_converted', true);
    end if;
    if v_application.status <> 'approved' then
        raise exception 'application_not_approved' using errcode = '22023';
    end if;
    if v_application.conversion_claimed_at is not null
       and v_application.conversion_claimed_at >= now() - interval '15 minutes' then
        raise exception 'conversion_in_progress' using errcode = '55000';
    end if;

    update public.driver_applications
       set conversion_claim_id = v_claim_id,
           conversion_claimed_at = now(),
           conversion_claimed_by = auth.uid()
     where id = v_application.id
     returning * into v_application;

    return to_jsonb(v_application) || jsonb_build_object(
        'conversion_claim_id', v_claim_id,
        'already_converted', false
    );
end;
$$;

create or replace function public.admin_release_driver_application_conversion(
    p_application_code text,
    p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    perform public.higo_assert_admin('manage_drivers', true);

    update public.driver_applications
       set conversion_claim_id = null,
           conversion_claimed_at = null,
           conversion_claimed_by = null
     where application_code = upper(trim(p_application_code))
       and conversion_claim_id = p_claim_id
       and status = 'approved';
    get diagnostics v_count = row_count;
    return v_count = 1;
end;
$$;

create or replace function public.admin_complete_driver_application_conversion(
    p_application_code text,
    p_claim_id uuid,
    p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_before public.driver_applications%rowtype;
    v_after public.driver_applications%rowtype;
begin
    perform public.higo_assert_admin('manage_drivers', true);

    select * into v_before
      from public.driver_applications
     where application_code = upper(trim(p_application_code))
     for update;

    if not found then
        raise exception 'driver_application_not_found' using errcode = 'P0002';
    end if;
    if v_before.status = 'converted' and v_before.converted_user_id = p_user_id then
        return to_jsonb(v_before);
    end if;
    if v_before.status <> 'approved'
       or v_before.conversion_claim_id is distinct from p_claim_id
       or v_before.conversion_claimed_by is distinct from auth.uid()
       or v_before.conversion_claimed_at < now() - interval '15 minutes' then
        raise exception 'invalid_conversion_claim' using errcode = '55000';
    end if;

    update public.driver_applications
       set status = 'converted',
           converted_user_id = p_user_id,
           converted_at = now(),
           last_status_changed_at = now(),
           last_status_changed_by = auth.uid(),
           conversion_claim_id = null,
           conversion_claimed_at = null,
           conversion_claimed_by = null
     where id = v_before.id
     returning * into v_after;

    insert into public.driver_application_events(
        application_id, actor_type, actor_id, event_type, from_status, to_status, metadata
    ) values (
        v_before.id, 'admin', auth.uid(), 'driver_account_created',
        v_before.status, v_after.status, jsonb_build_object('user_id', p_user_id)
    );

    insert into public.admin_audit_log(
        actor_id, action, entity_type, entity_id, before_data, after_data, reason, metadata
    ) values (
        auth.uid(), 'driver_application.convert', 'driver_application', v_before.application_code,
        jsonb_build_object('status', v_before.status),
        jsonb_build_object('status', v_after.status, 'user_id', p_user_id),
        'Solicitud aprobada convertida a cuenta Higo Driver',
        jsonb_build_object('source', 'admin_driver_applications')
    );

    return to_jsonb(v_after);
end;
$$;

revoke all on function public.higo_claim_driver_application_upload_token(text) from public, anon, authenticated;
revoke all on function public.higo_release_driver_application_upload_token(text,uuid) from public, anon, authenticated;
revoke all on function public.higo_complete_driver_application_upload(text,uuid,integer) from public, anon, authenticated;
grant execute on function public.higo_claim_driver_application_upload_token(text) to service_role;
grant execute on function public.higo_release_driver_application_upload_token(text,uuid) to service_role;
grant execute on function public.higo_complete_driver_application_upload(text,uuid,integer) to service_role;

revoke all on function public.admin_claim_driver_application_conversion(text) from public, anon;
revoke all on function public.admin_release_driver_application_conversion(text,uuid) from public, anon;
revoke all on function public.admin_complete_driver_application_conversion(text,uuid,uuid) from public, anon;
grant execute on function public.admin_claim_driver_application_conversion(text) to authenticated;
grant execute on function public.admin_release_driver_application_conversion(text,uuid) to authenticated;
grant execute on function public.admin_complete_driver_application_conversion(text,uuid,uuid) to authenticated;

commit;
