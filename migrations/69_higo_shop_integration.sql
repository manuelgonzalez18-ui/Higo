-- ====================================================================
-- 69 · Higo Shop Integration Migration
-- ====================================================================
-- This migration sets up the required tables, check constraints, RLS
-- policies, and Realtime replication for the Higo Shop module.

BEGIN;

-- ====================================================================
-- 1. RECONCILE PROFILES TABLE ROLES
-- ====================================================================
-- Drop the existing role CHECK constraint and recreate it to include 'merchant'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles 
  ADD CONSTRAINT profiles_role_check 
  CHECK (role IN ('admin', 'driver', 'passenger', 'merchant'));

-- ====================================================================
-- 2. CREATE STORES TABLE
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.stores (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  category text not null check (category in ('restaurant', 'pharmacy', 'bakery', 'grocery', 'cafe')),
  description text,
  image_url text,
  rating numeric(3,2) default 5.00 check (rating >= 1.00 and rating <= 5.00),
  review_count integer default 0 check (review_count >= 0),
  delivery_time text default '20-30 min',
  latitude double precision not null,
  longitude double precision not null,
  address text not null,
  phone text not null,
  is_open boolean not null default true,
  open_hours text default '8:00 AM - 10:00 PM',
  pago_movil jsonb not null, -- { phone: string, bank: string, cedula: string, holder: string }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- Stores RLS Policies
DROP POLICY IF EXISTS "Allow public read access to stores" ON public.stores;
CREATE POLICY "Allow public read access to stores"
  ON public.stores FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow store owners to insert/update their stores" ON public.stores;
CREATE POLICY "Allow store owners to insert/update their stores"
  ON public.stores FOR ALL
  USING (
    auth.uid() IN (
      SELECT id FROM public.profiles WHERE role = 'merchant' AND id = owner_id
    )
  );

-- ====================================================================
-- 3. CREATE PRODUCTS TABLE
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.products (
  id uuid default gen_random_uuid() primary key,
  store_id uuid references public.stores(id) on delete cascade not null,
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  category text not null, -- e.g. "Arepas", "Bebidas"
  image_url text,
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Products RLS Policies
DROP POLICY IF EXISTS "Allow public read access to products" ON public.products;
CREATE POLICY "Allow public read access to products"
  ON public.products FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow store owners to manage products in their stores" ON public.products;
CREATE POLICY "Allow store owners to manage products in their stores"
  ON public.products FOR ALL
  USING (
    auth.uid() IN (
      SELECT owner_id FROM public.stores WHERE id = store_id
    )
  );

-- ====================================================================
-- 4. CREATE DRIVERS TABLE (Shop specific satelite table)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid references public.profiles(id) on delete cascade primary key,
  vehicle text not null check (vehicle in ('Moto', 'Carro')),
  latitude double precision,
  longitude double precision,
  available boolean not null default true,
  rating numeric(3,2) default 5.00 check (rating >= 1.00 and rating <= 5.00),
  pago_movil jsonb not null, -- { phone: string, bank: string, cedula: string, holder: string }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

-- Drivers RLS Policies
DROP POLICY IF EXISTS "Allow public read access to drivers" ON public.drivers;
CREATE POLICY "Allow public read access to drivers"
  ON public.drivers FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow drivers to update their own record" ON public.drivers;
CREATE POLICY "Allow drivers to update their own record"
  ON public.drivers FOR UPDATE
  USING (auth.uid() = id);

-- ====================================================================
-- 5. CREATE ORDERS TABLE WITH GRANULAR STATUSES
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references public.profiles(id) on delete set null not null,
  store_id uuid references public.stores(id) on delete set null not null,
  driver_id uuid references public.profiles(id) on delete set null,
  status text not null default 'PENDING_PRODUCT_PAYMENT',
  total numeric(10,2) not null check (total >= 0),
  delivery_fee numeric(10,2) not null check (delivery_fee >= 0),
  items jsonb not null, -- Array of products: [{ id, name, quantity, price }]
  payment_method text not null check (payment_method in ('cash', 'pago_movil')), -- driver payment method
  payment_status text not null default 'PENDING' check (payment_status in ('PENDING', 'PAID', 'REFUNDED')),
  reference_number text, -- Pago Móvil reference number for store payment
  delivery_address text not null,
  delivery_latitude double precision not null,
  delivery_longitude double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Apply the expanded CHECK constraint to allow ALL granular checkout statuses
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders 
  ADD CONSTRAINT orders_status_check 
  CHECK (status IN (
    'PENDING_PRODUCT_PAYMENT',
    'PRODUCT_PAYMENT_REPORTED',
    'PRODUCT_PAYMENT_VERIFIED',
    'PREPARING',
    'READY_FOR_DRIVER_MATCH',
    'DRIVER_CANDIDATE_BROADCASTED',
    'DRIVER_ASSIGNED',
    'DRIVER_EN_ROUTE_TO_STORE',
    'PICKED_UP',
    'DRIVER_EN_ROUTE_TO_CUSTOMER',
    'DELIVERY_PAYMENT_PENDING',
    'DELIVERY_PAYMENT_REPORTED',
    'DELIVERY_PAYMENT_CONFIRMED',
    'DELIVERED',
    'CANCELLED',
    -- Legacy compatibility
    'PENDING_PAYMENT',
    'PAYMENT_VERIFIED',
    'READY_TO_DISPATCH'
  ));

-- Enable RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Orders RLS Policies
DROP POLICY IF EXISTS "Allow customers to manage their own orders" ON public.orders;
CREATE POLICY "Allow customers to manage their own orders"
  ON public.orders FOR ALL
  USING (auth.uid() = customer_id);

DROP POLICY IF EXISTS "Allow merchants to read/update orders for their stores" ON public.orders;
CREATE POLICY "Allow merchants to read/update orders for their stores"
  ON public.orders FOR ALL
  USING (
    auth.uid() IN (
      SELECT owner_id FROM public.stores WHERE id = store_id
    )
  );

DROP POLICY IF EXISTS "Allow drivers to view dispatchable or their assigned orders" ON public.orders;
CREATE POLICY "Allow drivers to view dispatchable or their assigned orders"
  ON public.orders FOR ALL
  USING (
    status IN ('READY_FOR_DRIVER_MATCH', 'DRIVER_CANDIDATE_BROADCASTED', 'READY_TO_DISPATCH') 
    OR auth.uid() = driver_id
  );

-- ====================================================================
-- 6. LIVE TRACKING AND EVENT LOGS
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.driver_locations (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references public.orders(id) on delete cascade not null,
  driver_id uuid references public.profiles(id) on delete cascade not null,
  lat double precision not null,
  lng double precision not null,
  bearing numeric,
  speed_kmh numeric,
  accuracy_m numeric,
  recorded_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS driver_locations_order_time_idx on public.driver_locations(order_id, recorded_at desc);
CREATE INDEX IF NOT EXISTS driver_locations_driver_time_idx on public.driver_locations(driver_id, recorded_at desc);

ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow customers, merchants and assigned driver to read tracking" ON public.driver_locations;
CREATE POLICY "Allow customers, merchants and assigned driver to read tracking"
  ON public.driver_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.stores s on s.id = o.store_id
      WHERE o.id = order_id
      AND (
        o.customer_id = auth.uid()
        OR o.driver_id = auth.uid()
        OR s.owner_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Allow assigned driver to insert tracking" ON public.driver_locations;
CREATE POLICY "Allow assigned driver to insert tracking"
  ON public.driver_locations FOR INSERT
  WITH CHECK (driver_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.order_events (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references public.orders(id) on delete cascade not null,
  event_type text not null,
  actor_type text not null check (actor_type in ('customer', 'merchant', 'driver', 'system')),
  actor_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS order_events_order_time_idx on public.order_events(order_id, created_at desc);

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow participants to read order events" ON public.order_events;
CREATE POLICY "Allow participants to read order events"
  ON public.order_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.stores s on s.id = o.store_id
      WHERE o.id = order_id
      AND (
        o.customer_id = auth.uid()
        OR o.driver_id = auth.uid()
        OR s.owner_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Allow participants to insert order events" ON public.order_events;
CREATE POLICY "Allow participants to insert order events"
  ON public.order_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.stores s on s.id = o.store_id
      WHERE o.id = order_id
      AND (
        o.customer_id = auth.uid()
        OR o.driver_id = auth.uid()
        OR s.owner_id = auth.uid()
      )
    )
  );

-- ====================================================================
-- 7. SEED DATA (Caracas mock defaults for initial setup)
-- ====================================================================
INSERT INTO public.stores (
  name, category, description, rating, review_count, delivery_time,
  latitude, longitude, address, phone, is_open, open_hours, pago_movil
) VALUES (
  'Arepera La Reina', 
  'restaurant', 
  'Las mejores arepas rellenas de Caracas con sabor tradicional.', 
  4.8, 
  142, 
  '20-30 min',
  10.4985, 
  -66.8872, 
  'Av. Francisco de Miranda, Altamira, Caracas', 
  '0412-1111111', 
  true, 
  '7:00 AM - 11:00 PM',
  '{"phone": "04121111111", "bank": "Banesco", "cedula": "V-12345678", "holder": "Arepera La Reina C.A."}'
) ON CONFLICT DO NOTHING;

INSERT INTO public.stores (
  name, category, description, rating, review_count, delivery_time,
  latitude, longitude, address, phone, is_open, open_hours, pago_movil
) VALUES (
  'Farmacia San Ignacio', 
  'pharmacy', 
  'Medicamentos, higiene personal y atención farmacéutica 24/7.', 
  4.9, 
  85, 
  '15-25 min',
  10.4902, 
  -66.9015, 
  'Centro Comercial San Ignacio, Chacao, Caracas', 
  '0412-2222222', 
  true, 
  '24 Horas',
  '{"phone": "04122222222", "bank": "Banco Mercantil", "cedula": "J-876543210", "holder": "Droguería San Ignacio"}'
) ON CONFLICT DO NOTHING;

INSERT INTO public.stores (
  name, category, description, rating, review_count, delivery_time,
  latitude, longitude, address, phone, is_open, open_hours, pago_movil
) VALUES (
  'Panadería La Guadalupe', 
  'bakery', 
  'Pan fresco, cachitos, pastelería fina y café recién molido.', 
  4.7, 
  210, 
  '15-30 min',
  10.4854, 
  -66.8621, 
  'Calle Madrid, Las Mercedes, Caracas', 
  '0412-3333333', 
  true, 
  '6:00 AM - 9:00 PM',
  '{"phone": "04123333333", "bank": "Provincial", "cedula": "V-99999999", "holder": "Panificadora Guadalupe"}'
) ON CONFLICT DO NOTHING;

-- ====================================================================
-- 8. REALTIME REPLICATION ENABLEMENT
-- ====================================================================
-- Supabase handles publication addition. Wrap in a transactional block to prevent
-- failing if already added.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'drivers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'driver_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'order_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_events;
  END IF;
END $$;

COMMIT;
