BEGIN;

UPDATE maintenance_monthly_targets SET target_inspection_count = 268;

CREATE OR REPLACE VIEW monthly_maintenance_kpi AS
WITH check_summary AS (
  SELECT
    date_trunc('month', inspection.inspected_on)::date AS month,
    count(*) FILTER (WHERE result.status = 'good')::integer AS good_count,
    count(*) FILTER (WHERE result.status = 'repair_needed')::integer AS repair_needed_count
  FROM maintenance_inspections inspection
  JOIN maintenance_check_results result ON result.inspection_id = inspection.id
  GROUP BY date_trunc('month', inspection.inspected_on)::date
), inspection_summary AS (
  SELECT
    date_trunc('month', inspected_on)::date AS month,
    count(*)::integer AS inspection_count
  FROM maintenance_inspections
  GROUP BY date_trunc('month', inspected_on)::date
)
SELECT
  target.month,
  LEAST(1.0, GREATEST(0.0, coalesce(inspections.inspection_count, 0)::numeric / target.target_inspection_count::numeric)) AS achievement_ratio,
  target.target_ratio,
  coalesce(checks.good_count, 0) AS good_count,
  coalesce(checks.repair_needed_count, 0) AS repair_needed_count,
  target.target_inspection_count AS planned_count,
  coalesce(inspections.inspection_count, 0) AS inspection_count,
  target.target_inspection_count
FROM maintenance_monthly_targets target
LEFT JOIN check_summary checks USING (month)
LEFT JOIN inspection_summary inspections USING (month);

COMMENT ON VIEW monthly_maintenance_kpi IS
  'Pencapaian KPI bulanan dihitung secara akurat dari jumlah perawatan aktual yang terlaksana dibagi target 4x perawatan bulanan untuk seluruh 67 unit (67 x 4 = 268).';

COMMIT;
