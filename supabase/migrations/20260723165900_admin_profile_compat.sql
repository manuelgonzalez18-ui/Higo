-- Compatibility for admin search. Auth remains the source of truth for credentials;
-- this optional profile field can be populated by signup/admin provisioning flows.
alter table public.profiles add column if not exists email text;
create index if not exists idx_profiles_email_lower on public.profiles(lower(email)) where email is not null;
