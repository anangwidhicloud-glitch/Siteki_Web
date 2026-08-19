BEGIN;

CREATE TABLE IF NOT EXISTS welding_transformer_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  legacy_source text NOT NULL DEFAULT 'Trafo API',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT welding_transformer_brands_name_not_blank CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS welding_transformer_brands_name_unique
  ON welding_transformer_brands (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS welding_transformer_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  legacy_source text NOT NULL DEFAULT 'Trafo API',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT welding_transformer_locations_name_not_blank CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS welding_transformer_locations_name_unique
  ON welding_transformer_locations (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS welding_transformers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  brand_id uuid REFERENCES welding_transformer_brands(id) ON UPDATE CASCADE ON DELETE SET NULL,
  brand_name text,
  transformer_type text,
  voltage text,
  acquired_on date,
  is_active boolean NOT NULL DEFAULT true,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT welding_transformers_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT welding_transformers_name_not_blank CHECK (btrim(name) <> '')
);
CREATE INDEX IF NOT EXISTS welding_transformers_brand_idx
  ON welding_transformers (brand_id, code);

CREATE TABLE IF NOT EXISTS welding_transformer_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transformer_id uuid NOT NULL REFERENCES welding_transformers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  inspected_at timestamptz NOT NULL,
  transformer_code text NOT NULL,
  transformer_name text NOT NULL,
  location_id uuid REFERENCES welding_transformer_locations(id) ON UPDATE CASCADE ON DELETE SET NULL,
  location_name text,
  condition text,
  operational_status text,
  welding_rod_status text,
  cable_status text,
  ground_clamp_status text,
  notes text,
  source_sheet text NOT NULL DEFAULT 'Inspeksi',
  legacy_sheet_row integer NOT NULL,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT welding_transformer_inspections_source_row_unique UNIQUE (source_sheet, legacy_sheet_row)
);
CREATE INDEX IF NOT EXISTS welding_transformer_inspections_asset_date_idx
  ON welding_transformer_inspections (transformer_id, inspected_at DESC);
CREATE INDEX IF NOT EXISTS welding_transformer_inspections_status_idx
  ON welding_transformer_inspections (operational_status, inspected_at DESC);

CREATE OR REPLACE VIEW latest_welding_transformer_inspections AS
SELECT DISTINCT ON (transformer_id) *
FROM welding_transformer_inspections
ORDER BY transformer_id, inspected_at DESC, legacy_sheet_row DESC;

CREATE OR REPLACE VIEW welding_transformer_inspection_summary AS
SELECT
  count(*)::integer AS inspection_count,
  count(DISTINCT transformer_id)::integer AS inspected_transformer_count,
  count(*) FILTER (WHERE lower(coalesce(condition, '')) = 'bagus')::integer AS good_condition_count,
  count(*) FILTER (WHERE lower(coalesce(condition, '')) = 'rusak')::integer AS damaged_condition_count,
  min(inspected_at) AS first_inspected_at,
  max(inspected_at) AS last_inspected_at
FROM welding_transformer_inspections;

DROP TRIGGER IF EXISTS welding_transformer_brands_set_updated_at ON welding_transformer_brands;
CREATE TRIGGER welding_transformer_brands_set_updated_at
BEFORE UPDATE ON welding_transformer_brands
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS welding_transformer_locations_set_updated_at ON welding_transformer_locations;
CREATE TRIGGER welding_transformer_locations_set_updated_at
BEFORE UPDATE ON welding_transformer_locations
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS welding_transformers_set_updated_at ON welding_transformers;
CREATE TRIGGER welding_transformers_set_updated_at
BEFORE UPDATE ON welding_transformers
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS welding_transformer_inspections_set_updated_at ON welding_transformer_inspections;
CREATE TRIGGER welding_transformer_inspections_set_updated_at
BEFORE UPDATE ON welding_transformer_inspections
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

COMMIT;
