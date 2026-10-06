BEGIN;

ALTER TABLE part_requests
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz;

UPDATE part_requests
SET arrived_at = arrived_on::timestamp AT TIME ZONE 'Asia/Jakarta'
WHERE arrived_at IS NULL AND arrived_on IS NOT NULL;

CREATE INDEX IF NOT EXISTS part_requests_arrived_at_idx
  ON part_requests (arrived_at DESC)
  WHERE arrived_at IS NOT NULL;

COMMIT;
