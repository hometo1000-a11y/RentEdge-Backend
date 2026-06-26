-- =====================================================
-- RentEdge — Rent Due Automation Migration
-- Run this in Supabase SQL Editor (one-time migration)
-- =====================================================

-- Step 1: Add new columns to property_tenants
ALTER TABLE property_tenants
  ADD COLUMN IF NOT EXISTS lease_start_date DATE,
  ADD COLUMN IF NOT EXISTS billing_day INTEGER,
  ADD COLUMN IF NOT EXISTS next_due_date DATE,
  ADD COLUMN IF NOT EXISTS last_paid_date DATE,
  ADD COLUMN IF NOT EXISTS agreed_rent_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

-- Step 2: Add a partial index to optimize the hourly worker query
CREATE INDEX IF NOT EXISTS idx_pt_active_due
ON property_tenants (status, next_due_date)
WHERE status = 'active' AND left_at IS NULL;

-- Step 3: Verify the migration (should show 6 new columns)
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'property_tenants'
ORDER BY ordinal_position;
