BEGIN;

CREATE TABLE IF NOT EXISTS electricity_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT electricity_panels_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT electricity_panels_name_not_blank CHECK (btrim(name) <> '')
);

INSERT INTO electricity_panels (code, name, sort_order)
VALUES
  ('panel_1', 'Panel 1', 1),
  ('panel_2', 'Panel 2', 2),
  ('panel_3', 'Panel 3', 3),
  ('panel_4', 'Panel 4', 4)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS electricity_power_factor_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  electricity_check_id uuid REFERENCES electricity_checks(id) ON UPDATE CASCADE ON DELETE CASCADE,
  panel_id uuid NOT NULL REFERENCES electricity_panels(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  officer_id uuid REFERENCES electricity_officers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  checked_at timestamptz NOT NULL,
  officer_name text NOT NULL,
  power_factor numeric(6, 4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT electricity_power_factor_value_range CHECK (power_factor >= 0 AND power_factor <= 1),
  CONSTRAINT electricity_power_factor_check_panel_unique UNIQUE (electricity_check_id, panel_id)
);

CREATE INDEX IF NOT EXISTS electricity_power_factor_panel_date_idx
  ON electricity_power_factor_readings (panel_id, created_at DESC);

DROP TRIGGER IF EXISTS electricity_panels_set_updated_at ON electricity_panels;
CREATE TRIGGER electricity_panels_set_updated_at
BEFORE UPDATE ON electricity_panels
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

COMMIT;
