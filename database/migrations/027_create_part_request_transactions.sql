BEGIN;

CREATE TABLE IF NOT EXISTS part_request_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE,
  requested_on date NOT NULL,
  requester_name text NOT NULL,
  department text,
  machine_name text,
  notes text,
  photo_url text,
  photo_public_id text,
  photo_bytes integer,
  photo_width integer,
  photo_height integer,
  scan_enhanced boolean NOT NULL DEFAULT false,
  item_count smallint NOT NULL,
  status text NOT NULL DEFAULT 'Open',
  created_by uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT part_request_transactions_item_count_valid CHECK (item_count BETWEEN 1 AND 10),
  CONSTRAINT part_request_transactions_status_not_blank CHECK (btrim(status) <> '')
);

ALTER TABLE part_requests
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES part_request_transactions(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_position smallint;

CREATE INDEX IF NOT EXISTS part_request_transactions_date_idx
  ON part_request_transactions (requested_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS part_requests_transaction_idx
  ON part_requests (transaction_id, item_position);

DROP TRIGGER IF EXISTS part_request_transactions_set_updated_at ON part_request_transactions;
CREATE TRIGGER part_request_transactions_set_updated_at
BEFORE UPDATE ON part_request_transactions
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

COMMIT;
