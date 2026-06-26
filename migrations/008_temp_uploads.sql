-- 008_temp_uploads.sql

CREATE TABLE IF NOT EXISTS temp_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  imagekit_file_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_temp_uploads_session_id ON temp_uploads(session_id);
CREATE INDEX IF NOT EXISTS idx_temp_uploads_owner_id ON temp_uploads(owner_id);
CREATE INDEX IF NOT EXISTS idx_temp_uploads_created_at ON temp_uploads(created_at);
