CREATE TABLE IF NOT EXISTS property_tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(property_id, tenant_id)
);

-- Enable RLS
ALTER TABLE property_tenants ENABLE ROW LEVEL SECURITY;

-- Policies
-- Tenants can view their own tenancies
CREATE POLICY "Tenants can view their own tenancies" ON property_tenants
    FOR SELECT USING (auth.uid() = tenant_id);

-- Owners can view tenancies for their properties
CREATE POLICY "Owners can view tenancies for their properties" ON property_tenants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM properties
            WHERE properties.id = property_tenants.property_id
            AND properties.owner_id = auth.uid()
        )
    );
