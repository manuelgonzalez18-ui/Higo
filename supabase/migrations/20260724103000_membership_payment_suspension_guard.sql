-- A validated membership payment may clear only a suspension caused by
-- onboarding or membership expiry. Disciplinary/operational suspensions must
-- survive the payment and require an explicit audited admin action.

begin;

create or replace function public.register_membership_payment_v3(
    p_driver_id uuid,
    p_plan_id uuid,
    p_payment_type text,
    p_bank_origin text,
    p_reference text,
    p_sender_phone text,
    p_amount_reported numeric,
    p_amount_real numeric,
    p_trn_date date,
    p_banesco_status text,
    p_raw_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_original_suspended_at timestamptz;
    v_original_reason text;
    v_membership_suspension boolean := false;
    v_result jsonb;
begin
    select p.suspended_at, p.suspension_reason
    into v_original_suspended_at, v_original_reason
    from public.profiles p
    where p.id = p_driver_id
      and p.role = 'driver'
    for update;

    if not found then
        raise exception 'driver_not_found';
    end if;

    v_membership_suspension := coalesce(v_original_reason, '') in (
        '',
        'pending_membership',
        'Alta administrativa pendiente de registrar membresía',
        'membership_expired',
        'Membresía vencida'
    );

    v_result := public.register_membership_payment_v2(
        p_driver_id,
        p_plan_id,
        p_payment_type,
        p_bank_origin,
        p_reference,
        p_sender_phone,
        p_amount_reported,
        p_amount_real,
        p_trn_date,
        p_banesco_status,
        p_raw_response
    );

    if v_original_suspended_at is not null and not v_membership_suspension then
        update public.profiles
        set suspended_at = v_original_suspended_at,
            suspension_reason = v_original_reason,
            subscription_status = 'suspended'
        where id = p_driver_id;

        if to_regclass('public.admin_audit_log') is not null then
            insert into public.admin_audit_log(
                actor_id, action, entity_type, entity_id, after_data, reason, metadata
            ) values (
                p_driver_id,
                'membership.payment_preserved_suspension',
                'profile',
                p_driver_id::text,
                jsonb_build_object(
                    'membership_id', v_result->>'membership_id',
                    'suspended_at', v_original_suspended_at,
                    'suspension_reason', v_original_reason
                ),
                'El pago renovó la membresía pero no levantó una suspensión disciplinaria.',
                jsonb_build_object('source', 'register_membership_payment_v3')
            );
        end if;
    else
        perform public.higo_sync_driver_membership(p_driver_id);
    end if;

    return v_result || jsonb_build_object(
        'operational_suspension_preserved',
        v_original_suspended_at is not null and not v_membership_suspension
    );
end;
$$;

revoke all on function public.register_membership_payment_v3(
    uuid, uuid, text, text, text, text, numeric, numeric, date, text, jsonb
) from public, anon, authenticated;
grant execute on function public.register_membership_payment_v3(
    uuid, uuid, text, text, text, text, numeric, numeric, date, text, jsonb
) to service_role;

commit;
