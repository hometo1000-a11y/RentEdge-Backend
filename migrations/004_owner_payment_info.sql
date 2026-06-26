CREATE TABLE IF NOT EXISTS owner_payment_info (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_holder_name TEXT,
    bank_account_number TEXT,
    ifsc_code TEXT,
    upi_id TEXT,
    bank_verified BOOLEAN DEFAULT FALSE,
    verification_status TEXT DEFAULT 'pending',
    penny_drop_reference TEXT,
    payment_provider TEXT,
    provider_account_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);
