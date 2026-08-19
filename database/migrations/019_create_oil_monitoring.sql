BEGIN;

CREATE TABLE IF NOT EXISTS oil_reservoirs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid REFERENCES machines(id) ON UPDATE CASCADE ON DELETE SET NULL,
  name text NOT NULL,
  length_cm numeric(12, 3),
  width_cm numeric(12, 3),
  height_cm numeric(12, 3),
  capacity_liters numeric(14, 3),
  oil_type text,
  minimum_level_percent numeric(5, 2) NOT NULL DEFAULT 30,
  check_interval_days integer NOT NULL DEFAULT 7,
  notes text,
  capacity_anomaly boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  source_sheet text NOT NULL DEFAULT 'VOLUME',
  legacy_sheet_row integer UNIQUE,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oil_reservoirs_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT oil_reservoirs_dimensions_positive CHECK (
    (length_cm IS NULL OR length_cm > 0) AND
    (width_cm IS NULL OR width_cm > 0) AND
    (height_cm IS NULL OR height_cm > 0) AND
    (capacity_liters IS NULL OR capacity_liters > 0)
  ),
  CONSTRAINT oil_reservoirs_minimum_level_range
    CHECK (minimum_level_percent BETWEEN 0 AND 100),
  CONSTRAINT oil_reservoirs_interval_positive CHECK (check_interval_days > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS oil_reservoirs_name_unique
  ON oil_reservoirs (lower(btrim(name)));
CREATE INDEX IF NOT EXISTS oil_reservoirs_machine_idx
  ON oil_reservoirs (machine_id, name);

CREATE TABLE IF NOT EXISTS oil_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservoir_id uuid NOT NULL REFERENCES oil_reservoirs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  machine_id uuid REFERENCES machines(id) ON UPDATE CASCADE ON DELETE SET NULL,
  checked_on date NOT NULL,
  checked_by_user_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  level_percent numeric(5, 2) NOT NULL,
  refill_liters numeric(12, 3),
  oil_condition text,
  notes text,
  source_sheet text NOT NULL DEFAULT 'CEK OLI',
  legacy_sheet_row integer NOT NULL,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oil_checks_source_row_unique UNIQUE (source_sheet, legacy_sheet_row),
  CONSTRAINT oil_checks_level_range CHECK (level_percent BETWEEN 0 AND 100),
  CONSTRAINT oil_checks_refill_nonnegative CHECK (refill_liters IS NULL OR refill_liters >= 0)
);
CREATE INDEX IF NOT EXISTS oil_checks_reservoir_date_idx
  ON oil_checks (reservoir_id, checked_on DESC, legacy_sheet_row DESC);
CREATE INDEX IF NOT EXISTS oil_checks_low_level_idx
  ON oil_checks (level_percent, checked_on DESC);

CREATE OR REPLACE VIEW oil_check_details AS
SELECT
  checks.*,
  reservoirs.name AS reservoir_name,
  reservoirs.capacity_liters,
  reservoirs.minimum_level_percent,
  reservoirs.check_interval_days,
  CASE
    WHEN reservoirs.capacity_liters IS NULL THEN NULL
    ELSE (reservoirs.capacity_liters * checks.level_percent / 100)::numeric(14, 3)
  END AS estimated_oil_liters,
  CASE
    WHEN checks.level_percent < reservoirs.minimum_level_percent THEN 'KRITIS'
    WHEN checks.level_percent < reservoirs.minimum_level_percent + 10 THEN 'PERHATIAN'
    ELSE 'NORMAL'
  END AS level_status
FROM oil_checks checks
JOIN oil_reservoirs reservoirs ON reservoirs.id = checks.reservoir_id;

CREATE OR REPLACE VIEW latest_oil_checks AS
SELECT DISTINCT ON (reservoir_id) *
FROM oil_check_details
ORDER BY reservoir_id, checked_on DESC, legacy_sheet_row DESC;

CREATE OR REPLACE VIEW oil_monitoring_summary AS
SELECT
  (SELECT count(*)::integer FROM oil_reservoirs WHERE is_active) AS reservoir_count,
  count(latest.reservoir_id)::integer AS checked_reservoir_count,
  count(*) FILTER (WHERE latest.level_status = 'KRITIS')::integer AS critical_count,
  count(*) FILTER (WHERE latest.level_status = 'PERHATIAN')::integer AS attention_count,
  count(*) FILTER (
    WHERE latest.reservoir_id IS NOT NULL
      AND latest.checked_on + reservoirs.check_interval_days < current_date
  )::integer AS overdue_count,
  count(*) FILTER (WHERE latest.reservoir_id IS NULL)::integer AS never_checked_count
FROM oil_reservoirs reservoirs
LEFT JOIN latest_oil_checks latest ON latest.reservoir_id = reservoirs.id
WHERE reservoirs.is_active;

DROP TRIGGER IF EXISTS oil_reservoirs_set_updated_at ON oil_reservoirs;
CREATE TRIGGER oil_reservoirs_set_updated_at
BEFORE UPDATE ON oil_reservoirs
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS oil_checks_set_updated_at ON oil_checks;
CREATE TRIGGER oil_checks_set_updated_at
BEFORE UPDATE ON oil_checks
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

COMMIT;
