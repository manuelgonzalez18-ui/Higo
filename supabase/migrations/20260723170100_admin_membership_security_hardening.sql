-- The administrative view is consumed only from SECURITY DEFINER RPCs.
-- Prevent authenticated clients from selecting the full driver directory directly.
revoke all on public.admin_driver_membership_status from anon, authenticated;

-- Direct writes are disallowed; sensitive membership mutations go through audited RPCs.
alter table public.driver_memberships enable row level security;
drop policy if exists admin_direct_driver_memberships on public.driver_memberships;

-- Admins may read payment history; inserts/updates/deletes remain RPC-only.
drop policy if exists admin_read_driver_memberships on public.driver_memberships;
create policy admin_read_driver_memberships
on public.driver_memberships for select
using (public.higo_is_admin());

revoke insert, update, delete on public.driver_memberships from anon, authenticated;
revoke insert, update, delete on public.admin_audit_log from anon, authenticated;
