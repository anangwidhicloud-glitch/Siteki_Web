BEGIN;

CREATE TABLE IF NOT EXISTS stang_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  source_sheet text,
  legacy_sheet_row integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stang_brands_name_not_blank CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS stang_brands_name_unique
  ON stang_brands (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS stang_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  source_sheet text,
  legacy_sheet_row integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stang_groups_name_not_blank CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS stang_groups_name_unique
  ON stang_groups (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS stang_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  source_sheet text,
  legacy_sheet_row integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stang_locations_name_not_blank CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS stang_locations_name_unique
  ON stang_locations (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS stang_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text,
  issued_on date,
  issued_group_id uuid REFERENCES stang_groups(id) ON UPDATE CASCADE ON DELETE SET NULL,
  issued_by_name text,
  used_location_id uuid REFERENCES stang_locations(id) ON UPDATE CASCADE ON DELETE SET NULL,
  used_location_name text,
  returned_on date,
  returned_group_id uuid REFERENCES stang_groups(id) ON UPDATE CASCADE ON DELETE SET NULL,
  returned_by_name text,
  from_location_id uuid REFERENCES stang_locations(id) ON UPDATE CASCADE ON DELETE SET NULL,
  from_location_name text,
  brand_id uuid REFERENCES stang_brands(id) ON UPDATE CASCADE ON DELETE SET NULL,
  brand_name text,
  duration_days integer,
  notes text,
  data_anomaly boolean NOT NULL DEFAULT false,
  source_sheet text NOT NULL DEFAULT 'Database',
  legacy_sheet_row integer NOT NULL,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stang_transactions_source_row_unique UNIQUE (source_sheet, legacy_sheet_row)
);
CREATE UNIQUE INDEX IF NOT EXISTS stang_transactions_code_unique
  ON stang_transactions (code) WHERE code IS NOT NULL AND btrim(code) <> '';
CREATE INDEX IF NOT EXISTS stang_transactions_issued_idx
  ON stang_transactions (issued_on DESC);
CREATE INDEX IF NOT EXISTS stang_transactions_open_idx
  ON stang_transactions (issued_on DESC) WHERE returned_on IS NULL;
CREATE INDEX IF NOT EXISTS stang_transactions_brand_idx
  ON stang_transactions (brand_id, issued_on DESC);

CREATE OR REPLACE VIEW stang_transaction_status AS
SELECT
  transactions.*,
  CASE WHEN returned_on IS NULL THEN 'BELUM KEMBALI' ELSE 'SUDAH KEMBALI' END AS status,
  CASE
    WHEN issued_on IS NOT NULL AND returned_on IS NOT NULL THEN returned_on - issued_on
    ELSE NULL
  END AS calculated_duration_days
FROM stang_transactions transactions;

CREATE OR REPLACE VIEW stang_summary AS
SELECT
  count(*)::integer AS total_issued,
  count(*) FILTER (WHERE returned_on IS NOT NULL)::integer AS total_returned,
  count(*) FILTER (WHERE returned_on IS NULL)::integer AS total_open,
  count(*) FILTER (WHERE code IS NULL OR btrim(code) = '')::integer AS missing_code_count,
  min(returned_on - issued_on) FILTER (
    WHERE issued_on IS NOT NULL AND returned_on IS NOT NULL
  )::integer AS shortest_duration_days,
  max(returned_on - issued_on) FILTER (
    WHERE issued_on IS NOT NULL AND returned_on IS NOT NULL
  )::integer AS longest_duration_days,
  avg(returned_on - issued_on) FILTER (
    WHERE issued_on IS NOT NULL AND returned_on IS NOT NULL
  )::numeric(12, 2) AS average_duration_days
FROM stang_transactions;

DROP TRIGGER IF EXISTS stang_brands_set_updated_at ON stang_brands;
CREATE TRIGGER stang_brands_set_updated_at
BEFORE UPDATE ON stang_brands
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS stang_groups_set_updated_at ON stang_groups;
CREATE TRIGGER stang_groups_set_updated_at
BEFORE UPDATE ON stang_groups
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS stang_locations_set_updated_at ON stang_locations;
CREATE TRIGGER stang_locations_set_updated_at
BEFORE UPDATE ON stang_locations
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS stang_transactions_set_updated_at ON stang_transactions;
CREATE TRIGGER stang_transactions_set_updated_at
BEFORE UPDATE ON stang_transactions
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

COMMIT;
