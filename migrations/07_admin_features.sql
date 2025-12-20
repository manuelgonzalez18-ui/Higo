-- 1. Add subscription and payment tracking columns to profiles
alter table public.profiles
add column subscription_status text check (subscription_status in ('active', 'suspended')) default 'active',
add column last_payment_date date,
add column payment_qr_url text,
add column vehicle_type text check (vehicle_type in ('Moto', 'Carro', 'Camioneta')) default 'Carro';

-- 2. Add email column to profiles (optional, for easier display in admin table if needed, though it's in auth.users)
-- We can't easily join auth.users in client query without a function, so we might duplicate email or fetch it. 
-- For now, let's just stick to the requested columns.
