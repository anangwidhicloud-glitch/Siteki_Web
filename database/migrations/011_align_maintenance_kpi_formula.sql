BEGIN;

ALTER TABLE maintenance_monthly_targets
  ADD COLUMN IF NOT EXISTS target_inspection_count integer NOT NULL DEFAULT 272;

ALTER TABLE maintenance_monthly_targets
  DROP CONSTRAINT IF EXISTS maintenance_targets_count_positive;

ALTER TABLE maintenance_monthly_targets
  ADD CONSTRAINT maintenance_targets_count_positive
    CHECK (target_inspection_count > 0);

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

COMMENT ON VIEW monthly_maintenance_kpi IS
  'Pencapaian mengikuti formula Sheets: jumlah jadwal bulanan dibagi target 272.';

COMMIT;
