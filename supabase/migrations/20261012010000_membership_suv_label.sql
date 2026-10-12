-- Commercial label correction: technical plan key "van" represents a
-- passenger Camioneta in Higo. This migration does not change membership price or
-- vehicle enum values; it only updates the driver-facing name.

update public.membership_plans
set display_name = 'Higo Camioneta'
where plan = 'van'
  and coalesce(display_name, '') <> 'Higo Camioneta';

notify pgrst, 'reload schema';
