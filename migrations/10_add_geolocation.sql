-- Add geolocation columns for Smart Assignment

-- Rides: Pickup coordinates
alter table public.rides add column pickup_lat float;
alter table public.rides add column pickup_lng float;

-- Profiles: Driver current location
alter table public.profiles add column curr_lat float;
alter table public.profiles add column curr_lng float;
alter table public.profiles add column last_location_update timestamp with time zone;
