-- Migration to add coordinates columns to rides table
ALTER TABLE rides 
ADD COLUMN IF NOT EXISTS pickup_lat FLOAT8,
ADD COLUMN IF NOT EXISTS pickup_lng FLOAT8,
ADD COLUMN IF NOT EXISTS dropoff_lat FLOAT8,
ADD COLUMN IF NOT EXISTS dropoff_lng FLOAT8;
