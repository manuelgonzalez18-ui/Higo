-- Higo Pay: canonical monthly rates + fiscal-invoice outbox.
-- Prices: USD15 moto; USD25 standard and van. Weekly rates deliberately unchanged.
-- Safe to rerun: historical memberships and reports are not repriced.
begin;

update public.driver_membership_plans
set amount = case code
    when 'moto-monthly' then 15
    when 'car-monthly' then 25
    when 'van-monthly' then 25
end,
updated_at = now()
where (code, vehicle_type, period, currency) in (
    ('moto-monthly','moto','monthly','USD'),
    ('car-monthly','standard','monthly','USD'),
    ('van-monthly','van','monthly','USD')
);

update public.membership_plans
set amount_usd = case plan when 'moto' then 15 when 'standard' then 25 when 'van' then 25 end,
    amount_bs = null, -- stale fixed Bs amounts must not be accepted as fallback prices
    bs_updated_at = null,
    updated_at = now()
where plan in ('moto','standard','van')
  and period = 'monthly';

-- The user can maintain their own billing identity, never an issuer's identity.
create table if not exists public.driver_billing_profiles (
    driver_id uuid primary key references public.profiles(id) on delete cascade,
    legal_name text not null check (char_length(btrim(legal_name)) between 2 and 200),
    fiscal_id text not null check (char_length(btrim(fiscal_id)) between 5 and 30),
    fiscal_address text not null check (char_length(btrim(fiscal_address)) between 8 and 500),
    email text not null check (char_length(btrim(email)) between 5 and 254 and email like '%@%'),
    updated_at timestamptz not null default now()
);

alter table public.driver_billing_profiles enable row level security;
revoke all on public.driver_billing_profiles from anon, authenticated;
grant select, insert, update on public.driver_billing_profiles to authenticated;

drop policy if exists driver_billing_select_own on public.driver_billing_profiles;
create policy driver_billing_select_own on public.driver_billing_profiles
for select to authenticated using (driver_id = (select auth.uid()));

drop policy if exists driver_billing_insert_own on public.driver_billing_profiles;
create policy driver_billing_insert_own on public.driver_billing_profiles
for insert to authenticated with check (driver_id = (select auth.uid()));

drop policy if exists driver_billing_update_own on public.driver_billing_profiles;
create policy driver_billing_update_own on public.driver_billing_profiles
for update to authenticated
using (driver_id = (select auth.uid()))
with check (driver_id = (select auth.uid()));

-- Fiscal documents are created by a server-side integration only.
-- Their identifiers must come from the fiscal provider, never from the mobile app.
create table if not exists public.membership_fiscal_invoices (
    id uuid primary key default gen_random_uuid(),
    payment_report_id bigint not null unique references public.payment_reports(id) on delete restrict,
    membership_id bigint not null unique references public.driver_memberships(id) on delete restrict,
    driver_id uuid not null references public.profiles(id) on delete restrict,
    amount_paid_bs numeric(18,2) not null check (amount_paid_bs > 0),
    status text not null default 'awaiting_billing_data'
        check (status in ('awaiting_billing_data','pending','processing','issued','failed','manual_review')),
    provider text,
    provider_document_id text,
    invoice_number text,
    control_number text,
    storage_path text,
    customer_email text,
    customer_name text,
    customer_fiscal_id text,
    customer_fiscal_address text,
    issued_at timestamptz,
    emailed_at timestamptz,
    attempt_count integer not null default 0 check (attempt_count >= 0),
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint issued_invoice_has_provider_control check (
      status <> 'issued' or
      (provider is not null and invoice_number is not null and control_number is not null and issued_at is not null)
    )
);
create index if not exists idx_membership_fiscal_invoices_status
on public.membership_fiscal_invoices(status, created_at)
where status in ('pending','failed','manual_review');

alter table public.membership_fiscal_invoices enable row level security;
revoke all on public.membership_fiscal_invoices from anon, authenticated;
grant select on public.membership_fiscal_invoices to authenticated;

drop policy if exists driver_read_own_membership_fiscal_invoices on public.membership_fiscal_invoices;
create policy driver_read_own_membership_fiscal_invoices
on public.membership_fiscal_invoices for select to authenticated
using (driver_id = (select auth.uid()));

-- Previously a driver could insert a report with status='validated'.
-- Only the trusted server/admin should be able to mark reports validated.
drop policy if exists drivers_insert_own_reports on public.payment_reports;
create policy drivers_insert_own_reports on public.payment_reports
for insert to authenticated
with check (
  driver_id = (select auth.uid())
  and status in ('pending','rejected')
  and membership_id is null
);

create or replace function public.higo_queue_validated_membership_invoice()
returns trigger
language plpgsql security definer
set search_path = ''
as $fn$
declare
  v_has_billing boolean;
begin
  if new.status <> 'validated'
     or new.membership_id is null
     or new.amount_real is null
     or new.amount_real <= 0 then
    return new;
  end if;

  -- A validated payment must reference a real membership belonging to the same driver.
  if not exists (
    select 1 from public.driver_memberships m
    where m.id = new.membership_id
      and m.driver_id = new.driver_id
      and m.voided_at is null
  ) then
    return new;
  end if;

  select exists (
    select 1 from public.driver_billing_profiles b
    where b.driver_id = new.driver_id
      and btrim(b.legal_name) <> ''
      and btrim(b.fiscal_id) <> ''
      and btrim(b.fiscal_address) <> ''
      and btrim(b.email) <> ''
  ) into v_has_billing;

  insert into public.membership_fiscal_invoices
    (payment_report_id, membership_id, driver_id, amount_paid_bs, status)
  values (new.id, new.membership_id, new.driver_id, new.amount_real,
          case when v_has_billing then 'pending' else 'awaiting_billing_data' end)
  on conflict (payment_report_id) do nothing;
  return new;
end;
$fn$;

revoke execute on function public.higo_queue_validated_membership_invoice() from public, anon, authenticated;
drop trigger if exists trg_higo_queue_validated_membership_invoice on public.payment_reports;
create trigger trg_higo_queue_validated_membership_invoice
after insert or update of status, membership_id on public.payment_reports
for each row execute function public.higo_queue_validated_membership_invoice();

create or replace function public.higo_ready_billing_invoices()
returns trigger
language plpgsql security definer
set search_path = ''
as $fn$
begin
  update public.membership_fiscal_invoices
  set status = 'pending', updated_at = now()
  where driver_id = new.driver_id and status = 'awaiting_billing_data';
  return new;
end;
$fn$;

revoke execute on function public.higo_ready_billing_invoices() from public, anon, authenticated;
drop trigger if exists trg_higo_ready_billing_invoices on public.driver_billing_profiles;
create trigger trg_higo_ready_billing_invoices
after insert or update on public.driver_billing_profiles
for each row execute function public.higo_ready_billing_invoices();

-- Private invoice PDFs. No client may upload/replace a fiscal document.
insert into storage.buckets(id, name, public)
values ('membership-invoices', 'membership-invoices', false)
on conflict (id) do update set public = false;

drop policy if exists drivers_read_own_membership_invoices on storage.objects;
create policy drivers_read_own_membership_invoices on storage.objects
for select to authenticated
using (bucket_id = 'membership-invoices'
  and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;