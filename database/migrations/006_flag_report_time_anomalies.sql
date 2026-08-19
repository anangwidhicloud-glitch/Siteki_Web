BEGIN;

ALTER TABLE work_reports
  DROP CONSTRAINT IF EXISTS work_reports_time_order;

ALTER TABLE work_reports
  ADD COLUMN IF NOT EXISTS time_anomaly boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duration_anomaly boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS work_reports_time_anomaly_idx
  ON work_reports (time_anomaly, duration_anomaly)
  WHERE time_anomaly OR duration_anomaly;

COMMENT ON COLUMN work_reports.time_anomaly IS
  'True jika waktu selesai pada data sumber lebih awal daripada waktu mulai.';

COMMENT ON COLUMN work_reports.duration_anomaly IS
  'True jika Total Jam berbeda signifikan dari selisih Jam Mulai dan Jam Selesai.';

COMMIT;
