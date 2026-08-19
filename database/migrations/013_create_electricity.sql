BEGIN;

CREATE TABLE IF NOT EXISTS electricity_officers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  legacy_sheet_row integer UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT electricity_officers_name_unique UNIQUE (name),
  CONSTRAINT electricity_officers_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS electricity_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id uuid REFERENCES electricity_officers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  checked_at timestamptz NOT NULL,
  officer_name text NOT NULL,
  huhe_h numeric(18, 6) NOT NULL,
  huhe_hh numeric(18, 6) NOT NULL,
  huar_heh numeric(18, 6) NOT NULL,
  huar_hh numeric(18, 6) NOT NULL,
  grid_from_mwh numeric(18, 6),
  pv_from_mwh numeric(18, 6),
  grid_to_mwh numeric(18, 6),
  kwh numeric(18, 6),
  kvar numeric(18, 6),
  difference numeric(18, 6),
  conclusion text,
  calculation_anomaly boolean NOT NULL DEFAULT false,
  source_sheet text NOT NULL DEFAULT 'Ceklistrik',
  legacy_sheet_row integer NOT NULL,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT electricity_checks_source_row_unique
    UNIQUE (source_sheet, legacy_sheet_row)
);

CREATE INDEX IF NOT EXISTS electricity_checks_date_idx
  ON electricity_checks (checked_at DESC);
CREATE INDEX IF NOT EXISTS electricity_checks_officer_idx
  ON electricity_checks (officer_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS electricity_checks_anomaly_idx
  ON electricity_checks (calculation_anomaly)
  WHERE calculation_anomaly;

CREATE OR REPLACE VIEW electricity_check_calculations AS
SELECT
  electricity_checks.*,
  (huhe_h - huhe_hh) * 0.62 AS calculated_kwh,
  huar_heh - huar_hh AS calculated_kvar,
  ((huhe_h - huhe_hh) * 0.62) - (huar_heh - huar_hh)
    AS calculated_difference,
  CASE
    WHEN huar_heh - huar_hh > (huhe_h - huhe_hh) * 0.62 THEN 'POTENSI DENDA'
    ELSE 'AMAN'
  END AS calculated_conclusion
FROM electricity_checks;

CREATE OR REPLACE VIEW latest_electricity_check AS
SELECT *
FROM electricity_check_calculations
ORDER BY checked_at DESC
LIMIT 1;

CREATE OR REPLACE VIEW monthly_electricity_summary AS
SELECT
  date_trunc('month', checked_at AT TIME ZONE 'Asia/Jakarta')::date AS month,
  count(*)::integer AS check_count,
  avg(kwh)::numeric(18, 6) AS average_kwh,
  avg(kvar)::numeric(18, 6) AS average_kvar,
  count(*) FILTER (
    WHERE upper(coalesce(conclusion, '')) <> 'AMAN'
  )::integer AS potential_penalty_count
FROM electricity_checks
GROUP BY date_trunc('month', checked_at AT TIME ZONE 'Asia/Jakarta')::date;

DROP TRIGGER IF EXISTS electricity_officers_set_updated_at ON electricity_officers;
CREATE TRIGGER electricity_officers_set_updated_at
BEFORE UPDATE ON electricity_officers
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS electricity_checks_set_updated_at ON electricity_checks;
CREATE TRIGGER electricity_checks_set_updated_at
BEFORE UPDATE ON electricity_checks
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

COMMIT;
