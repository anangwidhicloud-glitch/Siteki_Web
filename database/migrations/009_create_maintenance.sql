BEGIN;

CREATE TABLE IF NOT EXISTS maintenance_check_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_category text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_check_items_unique
    UNIQUE (machine_category, name, sort_order),
  CONSTRAINT maintenance_check_items_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS maintenance_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid REFERENCES machines(id) ON UPDATE CASCADE ON DELETE SET NULL,
  planned_on date NOT NULL,
  machine_type text,
  machine_name text NOT NULL,
  schedule_code text,
  maintenance_type text,
  source_sheet text NOT NULL DEFAULT 'Rekap Perawatan',
  legacy_sheet_row integer NOT NULL,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_plans_source_row_unique
    UNIQUE (source_sheet, legacy_sheet_row)
);

CREATE INDEX IF NOT EXISTS maintenance_plans_date_idx
  ON maintenance_plans (planned_on, machine_id);

CREATE TABLE IF NOT EXISTS maintenance_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES maintenance_plans(id) ON UPDATE CASCADE ON DELETE SET NULL,
  machine_id uuid REFERENCES machines(id) ON UPDATE CASCADE ON DELETE SET NULL,
  inspected_on date NOT NULL,
  machine_category text NOT NULL,
  machine_type text,
  machine_name text NOT NULL,
  schedule_code text,
  maintenance_type text,
  notes text,
  source_sheet text NOT NULL,
  legacy_sheet_row integer NOT NULL,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_inspections_source_row_unique
    UNIQUE (source_sheet, legacy_sheet_row)
);

CREATE INDEX IF NOT EXISTS maintenance_inspections_date_idx
  ON maintenance_inspections (inspected_on DESC);
CREATE INDEX IF NOT EXISTS maintenance_inspections_machine_idx
  ON maintenance_inspections (machine_id, inspected_on DESC);

CREATE TABLE IF NOT EXISTS maintenance_check_results (
  inspection_id uuid NOT NULL REFERENCES maintenance_inspections(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES maintenance_check_items(id) ON DELETE RESTRICT,
  status text NOT NULL,
  raw_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (inspection_id, item_id)
);

CREATE INDEX IF NOT EXISTS maintenance_check_results_status_idx
  ON maintenance_check_results (status, item_id);

CREATE TABLE IF NOT EXISTS maintenance_monthly_targets (
  month date PRIMARY KEY,
  target_ratio numeric(8, 6) NOT NULL DEFAULT 0.8,
  target_inspection_count integer NOT NULL DEFAULT 272,
  legacy_sheet_row integer UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_targets_first_day CHECK (extract(day FROM month) = 1),
  CONSTRAINT maintenance_targets_ratio CHECK (target_ratio BETWEEN 0 AND 1),
  CONSTRAINT maintenance_targets_count_positive CHECK (target_inspection_count > 0)
);

ALTER TABLE maintenance_monthly_targets
  ADD COLUMN IF NOT EXISTS target_inspection_count integer NOT NULL DEFAULT 272;

CREATE OR REPLACE VIEW monthly_maintenance_kpi AS
WITH check_summary AS (
  SELECT
    date_trunc('month', inspection.inspected_on)::date AS month,
    count(*) FILTER (WHERE result.status = 'good')::integer AS good_count,
    count(*) FILTER (WHERE result.status = 'repair_needed')::integer
      AS repair_needed_count
  FROM maintenance_inspections inspection
  JOIN maintenance_check_results result ON result.inspection_id = inspection.id
  GROUP BY date_trunc('month', inspection.inspected_on)::date
), plan_summary AS (
  SELECT date_trunc('month', planned_on)::date AS month, count(*)::integer AS planned_count
  FROM maintenance_plans
  GROUP BY date_trunc('month', planned_on)::date
), inspection_summary AS (
  SELECT date_trunc('month', inspected_on)::date AS month, count(*)::integer AS inspection_count
  FROM maintenance_inspections
  GROUP BY date_trunc('month', inspected_on)::date
)
SELECT
  target.month,
  coalesce(plans.planned_count, 0)::numeric /
    target.target_inspection_count::numeric AS achievement_ratio,
  target.target_ratio,
  coalesce(checks.good_count, 0) AS good_count,
  coalesce(checks.repair_needed_count, 0) AS repair_needed_count,
  coalesce(plans.planned_count, 0) AS planned_count,
  coalesce(inspections.inspection_count, 0) AS inspection_count,
  target.target_inspection_count
FROM maintenance_monthly_targets target
LEFT JOIN check_summary checks USING (month)
LEFT JOIN plan_summary plans USING (month)
LEFT JOIN inspection_summary inspections USING (month);

DROP TRIGGER IF EXISTS maintenance_check_items_set_updated_at ON maintenance_check_items;
CREATE TRIGGER maintenance_check_items_set_updated_at
BEFORE UPDATE ON maintenance_check_items
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS maintenance_plans_set_updated_at ON maintenance_plans;
CREATE TRIGGER maintenance_plans_set_updated_at
BEFORE UPDATE ON maintenance_plans
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS maintenance_inspections_set_updated_at ON maintenance_inspections;
CREATE TRIGGER maintenance_inspections_set_updated_at
BEFORE UPDATE ON maintenance_inspections
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS maintenance_monthly_targets_set_updated_at ON maintenance_monthly_targets;
CREATE TRIGGER maintenance_monthly_targets_set_updated_at
BEFORE UPDATE ON maintenance_monthly_targets
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

COMMIT;
