-- Fresh setup: create both tables
CREATE TABLE IF NOT EXISTS app_data (
  filename TEXT PRIMARY KEY,
  data_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_data (
  phone TEXT NOT NULL,
  data_key TEXT NOT NULL,
  data_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (phone, data_key)
);

ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all" ON app_data;
DROP POLICY IF EXISTS "Allow all" ON user_data;
CREATE POLICY "Allow all" ON app_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON user_data FOR ALL USING (true) WITH CHECK (true);
