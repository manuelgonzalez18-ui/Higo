-- Index for the driver-facing fiscal document history (RLS owner filtering).
create index if not exists idx_membership_fiscal_invoices_driver_created
on public.membership_fiscal_invoices(driver_id, created_at desc);