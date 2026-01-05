-- Add delivery columns to rides table
ALTER TABLE rides 
ADD COLUMN IF NOT EXISTS service_type TEXT DEFAULT 'ride', -- 'ride' or 'delivery'
ADD COLUMN IF NOT EXISTS delivery_info JSONB DEFAULT '{}'::jsonb, -- sender, receiver, instructions
ADD COLUMN IF NOT EXISTS payer TEXT DEFAULT 'sender'; -- 'sender' or 'receiver'
