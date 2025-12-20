-- GLOBAL SETUP SCRIPT (Run this entire file in Supabase SQL Editor)

-- 1. Create PROFILES Table
create table if not exists public.profiles (
  id uuid references auth.users not null primary key,
  full_name text,
  role text not null check (role in ('admin', 'driver', 'passenger')) default 'passenger',
  status text check (status in ('online', 'offline', 'busy')) default 'offline',
  vehicle_model text,
  license_plate text,
  avatar_url text, -- Added from migration 05
  phone text,      -- Added from migration 06
  -- New Admin Columns (Migration 07)
  subscription_status text check (subscription_status in ('active', 'suspended')) default 'active',
  last_payment_date date,
  payment_qr_url text,
  vehicle_type text check (vehicle_type in ('Moto', 'Carro', 'Camioneta')) default 'Carro',
  vehicle_brand text, -- Added from migration 08
  vehicle_color text, -- Added from migration 08
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Create RIDES Table (if not exists)
create table if not exists public.rides (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users not null,
    driver_id uuid references public.profiles(id),
    pickup text not null,
    dropoff text not null,
    status text check (status in ('requested', 'accepted', 'in_progress', 'completed', 'cancelled')) default 'requested',
    price numeric,
    ride_type text default 'standard', -- Added from migration 03
    rating int, -- Added from migration 04
    passenger_phone text, -- Added from migration 06
    created_at timestamp with time zone default now()
);

-- 3. Enable RLS
alter table public.profiles enable row level security;
alter table public.rides enable row level security;

-- 4. Policies (Profiles)
drop policy if exists "Public profiles are viewable by everyone" on profiles;
create policy "Public profiles are viewable by everyone" on profiles for select using ( true );

drop policy if exists "Users can insert their own profile" on profiles;
create policy "Users can insert their own profile" on profiles for insert with check ( auth.uid() = id );

drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile" on profiles for update using ( auth.uid() = id );

-- 5. Policies (Rides)
drop policy if exists "Drivers can view all requested rides" on rides;
create policy "Drivers can view all requested rides" on public.rides for select to authenticated
  using ( 
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'driver'
    )
    and status = 'requested' 
  );

drop policy if exists "Drivers can update rides to accept" on rides;
create policy "Drivers can update rides to accept" on public.rides for update to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'driver'
    )
  );
