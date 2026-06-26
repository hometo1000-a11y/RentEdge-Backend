-- Migration 020: Add columns for idempotent payment reversal

ALTER TABLE property_tenants
ADD COLUMN previous_last_paid_date DATE NULL,
ADD COLUMN previous_due_date DATE NULL;

-- Log the migration action
COMMENT ON COLUMN property_tenants.previous_last_paid_date IS 'Stores the last paid date prior to the most recent payment, for reversal.';
COMMENT ON COLUMN property_tenants.previous_due_date IS 'Stores the due date prior to the most recent payment, for reversal.';
