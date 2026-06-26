-- Migration 021: Rent Payment Proofs

CREATE TABLE IF NOT EXISTS rent_payment_proofs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_tenant_id UUID NOT NULL REFERENCES property_tenants(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    billing_period DATE NOT NULL,
    amount_due NUMERIC(12,2),
    amount_paid NUMERIC(12,2),
    payment_method TEXT NOT NULL,
    reference_number TEXT NOT NULL,
    screenshot_url TEXT NOT NULL,
    payment_date DATE NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved')),
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    UNIQUE(property_tenant_id, billing_period)
);

-- Enable RLS
ALTER TABLE rent_payment_proofs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Tenants can view their own payment proofs" ON rent_payment_proofs
    FOR SELECT USING (auth.uid() = tenant_id);

CREATE POLICY "Tenants can insert their own payment proofs" ON rent_payment_proofs
    FOR INSERT WITH CHECK (auth.uid() = tenant_id);

CREATE POLICY "Tenants can delete their pending proofs" ON rent_payment_proofs
    FOR DELETE USING (auth.uid() = tenant_id AND verification_status = 'pending');

CREATE POLICY "Owners can view payment proofs for their properties" ON rent_payment_proofs
    FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Owners can update verification status" ON rent_payment_proofs
    FOR UPDATE USING (auth.uid() = owner_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_property_tenant_id ON rent_payment_proofs(property_tenant_id);
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_tenant_id ON rent_payment_proofs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_owner_id ON rent_payment_proofs(owner_id);
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_billing_period ON rent_payment_proofs(billing_period);
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_verification_status ON rent_payment_proofs(verification_status);
