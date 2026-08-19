BEGIN;

DROP VIEW IF EXISTS oil_monitoring_summary;
DROP VIEW IF EXISTS latest_oil_checks;
DROP VIEW IF EXISTS oil_check_details;

ALTER TABLE oil_checks
  ALTER COLUMN legacy_sheet_row DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS created_by_username text,
  ADD COLUMN IF NOT EXISTS created_by_name text;

CREATE OR REPLACE VIEW oil_check_details AS
SELECT
  checks.*,
  reservoirs.name AS reservoir_name,
  reservoirs.capacity_liters,
  reservoirs.minimum_level_percent,
  reservoirs.check_interval_days,
  CASE
    WHEN reservoirs.capacity_liters IS NULL THEN NULL
    ELSE (reservoirs.capacity_liters * checks.level_percent / 100)::numeric(14, 3)
  END AS estimated_oil_liters,
  CASE
    WHEN checks.level_percent < reservoirs.minimum_level_percent THEN 'KRITIS'
    WHEN checks.level_percent < reservoirs.minimum_level_percent + 10 THEN 'PERHATIAN'
    ELSE 'NORMAL'
  END AS level_status
FROM oil_checks checks
JOIN oil_reservoirs reservoirs ON reservoirs.id = checks.reservoir_id;

CREATE OR REPLACE VIEW latest_oil_checks AS
SELECT DISTINCT ON (reservoir_id) *
FROM oil_check_details
ORDER BY reservoir_id, checked_on DESC, created_at DESC, id DESC;

CREATE OR REPLACE VIEW oil_monitoring_summary AS
SELECT
  (SELECT count(*)::integer FROM oil_reservoirs WHERE is_active) AS reservoir_count,
  count(latest.reservoir_id)::integer AS checked_reservoir_count,
  count(*) FILTER (WHERE latest.level_status = 'KRITIS')::integer AS critical_count,
  count(*) FILTER (WHERE latest.level_status = 'PERHATIAN')::integer AS attention_count,
  count(*) FILTER (
    WHERE latest.reservoir_id IS NOT NULL
      AND latest.checked_on + reservoirs.check_interval_days < current_date
  )::integer AS overdue_count,
  count(*) FILTER (WHERE latest.reservoir_id IS NULL)::integer AS never_checked_count
FROM oil_reservoirs reservoirs
LEFT JOIN latest_oil_checks latest ON latest.reservoir_id = reservoirs.id
WHERE reservoirs.is_active;

COMMIT;
