BEGIN;

ALTER TABLE work_reports
  DROP CONSTRAINT IF EXISTS work_reports_total_hours_nonnegative;

COMMENT ON COLUMN work_reports.total_hours IS
  'Nilai historis dipertahankan apa adanya; nilai negatif ditandai duration_anomaly.';

COMMIT;
