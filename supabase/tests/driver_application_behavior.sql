\set ON_ERROR_STOP on

begin;

insert into public.profiles(id, full_name, role, status)
values
    ('10000000-0000-4000-8000-000000000001', 'Admin Driver Test', 'admin', 'offline'),
    ('10000000-0000-4000-8000-000000000002', 'Converted Driver Test', 'driver', 'offline')
on conflict (id) do update set role = excluded.role;

insert into public.admin_staff_roles(user_id, staff_role, active)
values ('10000000-0000-4000-8000-000000000001', 'super_admin', true)
on conflict (user_id) do update set staff_role = excluded.staff_role, active = true;

select set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000001","aal":"aal2","role":"authenticated"}',
    true
);

insert into public.driver_applications(
    id, application_code, idempotency_hash, full_name, cedula, phone, phone_digits,
    email, email_hash, city, vehicle_type, vehicle_brand, vehicle_model, vehicle_color,
    license_plate, license_plate_hash, status, terms_version, privacy_version,
    accept_terms, accept_privacy
) values
(
    '20000000-0000-4000-8000-000000000001', 'HD-20260724-AAAABBBB', repeat('a', 64),
    'Applicant Upload', 'V-12345678', '04121234567', '04121234567',
    'upload@example.com', repeat('b', 64), 'Higuerote', 'moto', 'Yamaha', 'Test', 'Azul',
    'TEST01', repeat('c', 64), 'documents_requested', '2026-05-19', '2026-05-19', true, true
),
(
    '20000000-0000-4000-8000-000000000002', 'HD-20260724-CCCCDDDD', repeat('d', 64),
    'Applicant Approval', 'V-87654321', '04141234567', '04141234567',
    'approval@example.com', repeat('e', 64), 'Higuerote', 'carro', 'Toyota', 'Test', 'Blanco',
    'TEST02', repeat('f', 64), 'documents_submitted', '2026-05-19', '2026-05-19', true, true
);

insert into public.driver_application_upload_tokens(
    id, application_id, token_hash, expires_at, created_by
) values (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    repeat('1', 64),
    now() + interval '1 day',
    '10000000-0000-4000-8000-000000000001'
);

do $$
declare
    v_claim jsonb;
    v_claim_id uuid;
    v_second jsonb;
    v_completed jsonb;
begin
    v_claim := public.higo_claim_driver_application_upload_token(repeat('1', 64));
    if v_claim is null or coalesce(v_claim->>'upload_claim_id', '') = '' then
        raise exception 'upload claim was not created';
    end if;
    v_claim_id := (v_claim->>'upload_claim_id')::uuid;

    v_second := public.higo_claim_driver_application_upload_token(repeat('1', 64));
    if v_second is not null then
        raise exception 'same upload token was claimed twice';
    end if;

    v_completed := public.higo_complete_driver_application_upload(repeat('1', 64), v_claim_id, 6);
    if v_completed->>'status' <> 'documents_submitted' then
        raise exception 'document completion did not update application status';
    end if;

    if public.higo_claim_driver_application_upload_token(repeat('1', 64)) is not null then
        raise exception 'used upload token was accepted again';
    end if;
end;
$$;

do $$
begin
    begin
        perform public.admin_set_driver_application_status(
            'HD-20260724-CCCCDDDD', 'approved', null, '{}'::jsonb
        );
        raise exception 'approval unexpectedly succeeded without documents';
    exception
        when sqlstate '22023' then
            if sqlerrm not like '%required_documents_not_approved%' then
                raise;
            end if;
    end;
end;
$$;

insert into public.driver_application_documents(
    application_id, document_type, file_name, mime_type, size_bytes, storage_path,
    review_status, reviewed_by, reviewed_at
)
select
    '20000000-0000-4000-8000-000000000002'::uuid,
    document_type,
    document_type || case when document_type in ('profile_photo','vehicle_photo') then '.jpg' else '.pdf' end,
    case when document_type in ('profile_photo','vehicle_photo') then 'image/jpeg' else 'application/pdf' end,
    1000,
    'test/' || document_type || '/' || gen_random_uuid()::text,
    'approved',
    '10000000-0000-4000-8000-000000000001'::uuid,
    now()
from unnest(array[
    'profile_photo','identity','driver_license','vehicle_registration','rcv','vehicle_photo'
]) as document_type;

do $$
declare
    v_approved jsonb;
    v_claim jsonb;
    v_claim_id uuid;
    v_completed jsonb;
begin
    v_approved := public.admin_set_driver_application_status(
        'HD-20260724-CCCCDDDD', 'approved', null, '{}'::jsonb
    );
    if v_approved->>'status' <> 'approved' then
        raise exception 'application was not approved after all required documents passed';
    end if;

    v_claim := public.admin_claim_driver_application_conversion('HD-20260724-CCCCDDDD');
    v_claim_id := (v_claim->>'conversion_claim_id')::uuid;
    if v_claim_id is null then
        raise exception 'conversion claim was not created';
    end if;

    begin
        perform public.admin_claim_driver_application_conversion('HD-20260724-CCCCDDDD');
        raise exception 'second conversion claim unexpectedly succeeded';
    exception
        when sqlstate '55000' then
            if sqlerrm not like '%conversion_in_progress%' then
                raise;
            end if;
    end;

    v_completed := public.admin_complete_driver_application_conversion(
        'HD-20260724-CCCCDDDD',
        v_claim_id,
        '10000000-0000-4000-8000-000000000002'
    );
    if v_completed->>'status' <> 'converted'
       or v_completed->>'converted_user_id' <> '10000000-0000-4000-8000-000000000002' then
        raise exception 'conversion completion did not link the driver';
    end if;
end;
$$;

rollback;
