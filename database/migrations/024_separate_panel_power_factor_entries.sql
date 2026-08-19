BEGIN;

ALTER TABLE electricity_power_factor_readings
  ALTER COLUMN electricity_check_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS officer_id uuid REFERENCES electricity_officers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checked_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS officer_name text NOT NULL DEFAULT '';

DROP INDEX IF EXISTS electricity_power_factor_panel_date_idx;
CREATE INDEX IF NOT EXISTS electricity_power_factor_panel_date_idx
  ON electricity_power_factor_readings (panel_id, checked_at DESC);

COMMIT;
