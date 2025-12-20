-- Add ride_type column to rides table
alter table public.rides 
add column ride_type text default 'standard';
