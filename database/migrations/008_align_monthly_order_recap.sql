BEGIN;

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

COMMENT ON VIEW monthly_technical_kpi IS
  'Rekap bulanan yang menyamai formula Sheets; order_count menghitung semua laporan.';

COMMIT;
