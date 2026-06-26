-- 022_database_constraints_indexes.sql

-- Make migration idempotent by dropping the constraint if it exists
ALTER TABLE property_tenants 
DROP CONSTRAINT IF EXISTS chk_rent_status;

-- Add CHECK constraint for rent_status
ALTER TABLE property_tenants
ADD CONSTRAINT chk_rent_status
CHECK (
  rent_status IN ('due', 'pending', 'paid', 'inactive')
);

-- Add composite index on rent_payment_proofs for performance optimizations
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_history 
ON rent_payment_proofs (property_tenant_id, verification_status, payment_date DESC);
