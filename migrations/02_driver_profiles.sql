-- 1. Create profiles table
create table public.profiles (
  id uuid references auth.users not null primary key,
  full_name text,
  role text not null check (role in ('admin', 'driver', 'passenger')) default 'passenger',
  status text check (status in ('online', 'offline', 'busy')) default 'offline',
  vehicle_model text,
  license_plate text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Enable RLS
alter table public.profiles enable row level security;

-- 3. Policies
-- Public read access to profiles (needed for passengers to see driver info)
create policy "Public profiles are viewable by everyone"
  on profiles for select
  using ( true );

-- Users can insert their own profile
create policy "Users can insert their own profile"
  on profiles for insert
  with check ( auth.uid() = id );

-- Users can update own profile
create policy "Users can update own profile"
  on profiles for update
  using ( auth.uid() = id );

-- 4. Update Rides Policies for Drivers
-- Drivers can view ALL requested rides
create policy "Drivers can view all requested rides"
  on public.rides for select
  to authenticated
  using ( 
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'driver'
    )
    and status = 'requested' 
  );

-- Drivers can update rides (accept them)
create policy "Drivers can update rides to accept"
  on public.rides for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'driver'
    )
  );

-- 5. FUNCTION to create a manual driver (Run this block separately in SQL Editor with your desired email)
/*
-- REPLACE 'driver@higo.app' and 'password123' with desired credentials
-- This is just a helper comment, you must create the user in Auth > Users first, or use this SQL if Supabase allows (usually requires admin API).
-- BETTER APPROACH for manual setup:
-- 1. Create user in Supabase Dashboard (Auth).
-- 2. Grab their UUID.
-- 3. Run:
-- insert into public.profiles (id, role, full_name, vehicle_model, license_plate)
-- values ('USER_UUID_HERE', 'driver', 'Juan Pérez', 'Toyota Corolla', 'ABC-123');
*/
