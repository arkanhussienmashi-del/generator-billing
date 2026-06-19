-- Supabase Schema for Generator Billing
-- Run this in SQL Editor after creating your project

CREATE TABLE IF NOT EXISTS user_data (
  filename TEXT PRIMARY KEY,
  data_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS but allow all operations with anon key
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON user_data FOR ALL USING (true) WITH CHECK (true);
