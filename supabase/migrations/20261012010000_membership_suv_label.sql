-- Commercial label correction: technical plan key "van" represents a
-- passenger SUV in Higo. This migration does not change membership price or
-- vehicle enum values; it only updates the driver-facing name.

update public.membership_plans
set display_name = 'Higo SUV'
where plan = 'van'
  and coalesce(display_name, '') <> 'Higo SUV';

notify pgrst, 'reload schema';
