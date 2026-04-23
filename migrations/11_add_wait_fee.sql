-- Wait fee at pickup (driver waits >3 min for passenger).
-- Rate per minute by vehicle: moto $0.05, carro $0.08, camioneta $0.10.
ALTER TABLE rides
    ADD COLUMN IF NOT EXISTS wait_seconds INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS wait_fee NUMERIC DEFAULT 0;
