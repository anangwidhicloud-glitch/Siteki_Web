BEGIN;

ALTER TABLE inventory_balances
  ADD COLUMN IF NOT EXISTS location text;

CREATE INDEX IF NOT EXISTS inventory_balances_location_idx
  ON inventory_balances (location)
  WHERE nullif(btrim(location), '') IS NOT NULL;

COMMIT;
