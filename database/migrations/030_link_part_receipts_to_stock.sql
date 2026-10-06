BEGIN;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS part_request_id uuid REFERENCES part_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='stock_movements_part_request_unique'
      AND conrelid='stock_movements'::regclass
  ) THEN
    ALTER TABLE stock_movements
      ADD CONSTRAINT stock_movements_part_request_unique UNIQUE (part_request_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS stock_movements_part_request_idx
  ON stock_movements (part_request_id)
  WHERE part_request_id IS NOT NULL;

COMMIT;
