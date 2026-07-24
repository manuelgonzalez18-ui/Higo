-- Clear only onboarding/membership suspensions when a valid membership is
-- recorded. Disciplinary suspensions remain intact and cannot be removed by a
-- payment.

begin;

create or replace function public.higo_sync_driver_membership(p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_active boolean := false;
    v_last_payment timestamptz;
    v_pending_suspension boolean := false;
begin
    select
        exists(
            select 1
            from public.driver_memberships dm
            where dm.driver_id = p_driver_id
              and dm.voided_at is null
              and dm.status = 'active'
              and dm.expires_at >= now()
        ),
        max(dm.paid_at) filter (where dm.voided_at is null)
    into v_active, v_last_payment
    from public.driver_memberships dm
    where dm.driver_id = p_driver_id;

    select coalesce(p.suspension_reason, '') in (
        'pending_membership',
        'Alta administrativa pendiente de registrar membresía',
        'membership_expired',
        'Membresía vencida'
    )
    into v_pending_suspension
    from public.profiles p
    where p.id = p_driver_id;

    update public.profiles
    set subscription_status = case when v_active then 'active' else 'suspended' end,
        last_payment_date = v_last_payment,
        suspended_at = case
            when v_active and v_pending_suspension then null
            else suspended_at
        end,
        suspension_reason = case
            when v_active and v_pending_suspension then null
            else suspension_reason
        end
    where id = p_driver_id
      and role = 'driver';
end;
$$;

commit;
