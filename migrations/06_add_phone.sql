alter table public.profiles add column phone text;
-- Adding passenger phone to rides for this specific trip (in case they change numbers)
alter table public.rides add column passenger_phone text;
