BEGIN;

CREATE TABLE IF NOT EXISTS work_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid REFERENCES work_orders(id) ON UPDATE CASCADE ON DELETE SET NULL,
  machine_id uuid REFERENCES machines(id) ON UPDATE CASCADE ON DELETE SET NULL,
  part_id uuid REFERENCES parts(id) ON UPDATE CASCADE ON DELETE SET NULL,
  report_date date NOT NULL,
  department text,
  machine_category text,
  machine_type text,
  machine_name text,
  job_type text,
  work_description text,
  component_type text,
  started_at timestamptz,
  finished_at timestamptz,
  total_hours numeric(16, 3),
  definition text,
  spare_part_name text,
  spare_part_size text,
  order_type text,
  order_status text,
  repair_rating text,
  notes text,
  is_new_machine boolean NOT NULL DEFAULT false,
  is_new_part boolean NOT NULL DEFAULT false,
  time_anomaly boolean NOT NULL DEFAULT false,
  duration_anomaly boolean NOT NULL DEFAULT false,
  part_category text,
  source_sheet text NOT NULL DEFAULT 'lap_kerja',
  legacy_sheet_row integer NOT NULL,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_reports_source_row_unique
    UNIQUE (source_sheet, legacy_sheet_row)
);

CREATE INDEX IF NOT EXISTS work_reports_date_idx
  ON work_reports (report_date DESC);
CREATE INDEX IF NOT EXISTS work_reports_machine_idx
  ON work_reports (machine_id, report_date DESC);
CREATE INDEX IF NOT EXISTS work_reports_part_idx
  ON work_reports (part_id);
CREATE INDEX IF NOT EXISTS work_reports_department_idx
  ON work_reports (department, report_date DESC);
CREATE INDEX IF NOT EXISTS work_reports_order_status_idx
  ON work_reports (order_status, report_date DESC);

CREATE TABLE IF NOT EXISTS kpi_monthly_targets (
  month date PRIMARY KEY,
  target_hours numeric(16, 3) NOT NULL DEFAULT 500,
  legacy_sheet_row integer UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_monthly_targets_first_day
    CHECK (extract(day FROM month) = 1),
  CONSTRAINT kpi_monthly_targets_nonnegative CHECK (target_hours >= 0)
);

CREATE OR REPLACE VIEW monthly_technical_kpi AS
WITH report_summary AS (
  SELECT
    date_trunc('month', report_date)::date AS month,
    coalesce(sum(total_hours), 0)::numeric(16, 3) AS total_hours,
    count(*)::integer AS order_count,
    count(*) FILTER (WHERE lower(coalesce(repair_rating, '')) = 'bagus')::integer
      AS good_count,
    count(*) FILTER (WHERE lower(coalesce(repair_rating, '')) = 'cukup')::integer
      AS fair_count,
    count(*) FILTER (
      WHERE lower(replace(coalesce(repair_rating, ''), ' ', '')) = 'tidakbagus'
    )::integer AS poor_count
  FROM work_reports
  GROUP BY date_trunc('month', report_date)::date
)
SELECT
  targets.month,
  coalesce(summary.total_hours, 0)::numeric(16, 3) AS total_hours,
  targets.target_hours,
  coalesce(summary.order_count, 0) AS order_count,
  coalesce(summary.good_count, 0) AS good_count,
  coalesce(summary.fair_count, 0) AS fair_count,
  coalesce(summary.poor_count, 0) AS poor_count
FROM kpi_monthly_targets targets
LEFT JOIN report_summary summary USING (month);

CREATE OR REPLACE VIEW order_by_component AS
SELECT
  machine_name,
  count(*) FILTER (WHERE lower(component_type) = 'mekanikal')::integer AS mechanical,
  count(*) FILTER (WHERE lower(component_type) = 'elektrikal')::integer AS electrical,
  count(*) FILTER (WHERE lower(component_type) = 'konstruksi')::integer AS construction
FROM work_reports
WHERE machine_name IS NOT NULL
GROUP BY machine_name;

CREATE OR REPLACE VIEW repair_rating_by_department AS
SELECT
  department,
  count(*) FILTER (WHERE lower(repair_rating) = 'bagus')::integer AS good_count,
  count(*) FILTER (WHERE lower(repair_rating) = 'cukup')::integer AS fair_count,
  count(*) FILTER (
    WHERE lower(replace(coalesce(repair_rating, ''), ' ', '')) = 'tidakbagus'
  )::integer AS poor_count
FROM work_reports
WHERE department IS NOT NULL
GROUP BY department;

DROP TRIGGER IF EXISTS work_reports_set_updated_at ON work_reports;
CREATE TRIGGER work_reports_set_updated_at
BEFORE UPDATE ON work_reports
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS kpi_monthly_targets_set_updated_at ON kpi_monthly_targets;
CREATE TRIGGER kpi_monthly_targets_set_updated_at
BEFORE UPDATE ON kpi_monthly_targets
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

COMMIT;
