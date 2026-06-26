ALTER TABLE property_tenants ADD COLUMN IF NOT EXISTS rent_status VARCHAR(20) DEFAULT 'paid';
