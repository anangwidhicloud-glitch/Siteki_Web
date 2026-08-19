BEGIN;

-- Baris baru yang dibuat API Neon tidak lagi memiliki nomor baris Spreadsheet.
ALTER TABLE part_requests ALTER COLUMN legacy_sheet_row DROP NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN legacy_sheet_row DROP NOT NULL;
ALTER TABLE work_reports ALTER COLUMN legacy_sheet_row DROP NOT NULL;
ALTER TABLE maintenance_plans ALTER COLUMN legacy_sheet_row DROP NOT NULL;
ALTER TABLE maintenance_inspections ALTER COLUMN legacy_sheet_row DROP NOT NULL;
ALTER TABLE overtime_entries ALTER COLUMN legacy_sheet_row DROP NOT NULL;
ALTER TABLE electricity_checks ALTER COLUMN legacy_sheet_row DROP NOT NULL;
ALTER TABLE stang_transactions ALTER COLUMN legacy_sheet_row DROP NOT NULL;
ALTER TABLE welding_transformer_inspections ALTER COLUMN legacy_sheet_row DROP NOT NULL;

CREATE TABLE IF NOT EXISTS api_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip_address text,
  CONSTRAINT api_sessions_token_hash_not_blank CHECK (btrim(token_hash) <> '')
);
CREATE INDEX IF NOT EXISTS api_sessions_user_expiry_idx
  ON api_sessions (user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS api_sessions_expiry_idx
  ON api_sessions (expires_at);

CREATE TABLE IF NOT EXISTS national_holidays (
  holiday_date date PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT national_holidays_name_not_blank CHECK (btrim(name) <> '')
);
DROP TRIGGER IF EXISTS national_holidays_set_updated_at ON national_holidays;
CREATE TRIGGER national_holidays_set_updated_at
BEFORE UPDATE ON national_holidays
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

INSERT INTO national_holidays (holiday_date, name) VALUES
  ('2026-01-01', 'Tahun Baru Masehi'),
  ('2026-01-16', 'Isra Mikraj Nabi Muhammad SAW'),
  ('2026-02-17', 'Tahun Baru Imlek'),
  ('2026-03-19', 'Hari Suci Nyepi'),
  ('2026-03-20', 'Idul Fitri'),
  ('2026-03-21', 'Idul Fitri'),
  ('2026-04-03', 'Wafat Yesus Kristus'),
  ('2026-04-05', 'Kebangkitan Yesus Kristus'),
  ('2026-05-01', 'Hari Buruh Internasional'),
  ('2026-05-14', 'Kenaikan Yesus Kristus'),
  ('2026-05-27', 'Idul Adha'),
  ('2026-05-31', 'Hari Raya Waisak'),
  ('2026-06-01', 'Hari Lahir Pancasila'),
  ('2026-06-16', 'Tahun Baru Islam'),
  ('2026-08-17', 'Hari Kemerdekaan RI'),
  ('2026-08-25', 'Maulid Nabi Muhammad SAW'),
  ('2026-12-25', 'Hari Raya Natal')
ON CONFLICT (holiday_date) DO UPDATE SET name = excluded.name;

CREATE UNIQUE INDEX IF NOT EXISTS overtime_entries_user_date_unique
  ON overtime_entries (user_id, overtime_date)
  WHERE user_id IS NOT NULL;

COMMIT;
