-- =====================================================
-- RentEdge — Process 5: Database Integrity Engine
-- =====================================================

-- Step 1: Prevent invalid rent cycle calculations
ALTER TABLE property_tenants
ADD CONSTRAINT chk_billing_day CHECK (billing_day BETWEEN 1 AND 31);
