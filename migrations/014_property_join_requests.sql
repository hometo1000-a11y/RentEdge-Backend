CREATE TABLE IF NOT EXISTS property_join_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES users(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(tenant_id, property_id)
);

-- Enable RLS
ALTER TABLE property_join_requests ENABLE ROW LEVEL SECURITY;

-- Policies

-- Tenants can see their own requests
CREATE POLICY "Tenants can view their own join requests" ON property_join_requests
    FOR SELECT USING (auth.uid() = tenant_id);

-- Tenants can insert their own requests
CREATE POLICY "Tenants can create join requests" ON property_join_requests
    FOR INSERT WITH CHECK (auth.uid() = tenant_id);

-- Owners can view requests for their properties
CREATE POLICY "Owners can view join requests for their properties" ON property_join_requests
    FOR SELECT USING (auth.uid() = owner_id);

-- Owners can update the status of requests for their properties
CREATE POLICY "Owners can update join requests for their properties" ON property_join_requests
    FOR UPDATE USING (auth.uid() = owner_id);
