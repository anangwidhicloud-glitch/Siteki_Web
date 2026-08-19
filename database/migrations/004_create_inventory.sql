BEGIN;

CREATE TABLE IF NOT EXISTS parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text,
  name text NOT NULL,
  size text,
  component_type text,
  identity_key text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  legacy_sheet_row integer UNIQUE,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parts_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS parts_identity_key_idx ON parts (identity_key);
CREATE INDEX IF NOT EXISTS parts_category_name_idx ON parts (category, name);

CREATE TABLE IF NOT EXISTS inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid REFERENCES parts(id) ON UPDATE CASCADE ON DELETE SET NULL,
  category text,
  part_name text NOT NULL,
  part_size text,
  incoming_quantity numeric(16, 3),
  outgoing_quantity numeric(16, 3),
  current_quantity numeric(16, 3),
  unit text,
  legacy_sheet_row integer UNIQUE,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_balances_name_not_blank CHECK (btrim(part_name) <> '')
);

CREATE INDEX IF NOT EXISTS inventory_balances_part_id_idx
  ON inventory_balances (part_id);

CREATE TABLE IF NOT EXISTS part_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid REFERENCES parts(id) ON UPDATE CASCADE ON DELETE SET NULL,
  requested_on date,
  category text,
  part_name text,
  part_size text,
  notes text,
  purpose text,
  requested_quantity numeric(16, 3),
  requested_quantity_text text,
  department text,
  requester_name text,
  machine_name text,
  arrived_on date,
  arrived_quantity numeric(16, 3),
  arrived_quantity_text text,
  status text NOT NULL DEFAULT 'Open',
  source_sheet text NOT NULL,
  legacy_sheet_row integer NOT NULL,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT part_requests_source_row_unique
    UNIQUE (source_sheet, legacy_sheet_row),
  CONSTRAINT part_requests_status_not_blank CHECK (btrim(status) <> '')
);

CREATE INDEX IF NOT EXISTS part_requests_status_date_idx
  ON part_requests (status, requested_on DESC);
CREATE INDEX IF NOT EXISTS part_requests_part_id_idx
  ON part_requests (part_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid REFERENCES parts(id) ON UPDATE CASCADE ON DELETE SET NULL,
  occurred_on date,
  category text,
  part_name text,
  part_type text,
  part_size text,
  quantity numeric(16, 3),
  quantity_text text,
  unit text,
  used_for text,
  machine_name text,
  user_name text,
  department text,
  notes text,
  movement_type text NOT NULL DEFAULT 'usage',
  source_sheet text NOT NULL DEFAULT 'Penggunaan',
  legacy_sheet_row integer NOT NULL,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_source_row_unique
    UNIQUE (source_sheet, legacy_sheet_row),
  CONSTRAINT stock_movements_quantity_nonnegative
    CHECK (quantity IS NULL OR quantity >= 0)
);

CREATE INDEX IF NOT EXISTS stock_movements_part_date_idx
  ON stock_movements (part_id, occurred_on DESC);

CREATE TABLE IF NOT EXISTS work_order_parts (
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
  quantity numeric(16, 3) NOT NULL DEFAULT 1,
  unit text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_order_id, part_id),
  CONSTRAINT work_order_parts_quantity_positive CHECK (quantity > 0)
);

DROP TRIGGER IF EXISTS parts_set_updated_at ON parts;
CREATE TRIGGER parts_set_updated_at
BEFORE UPDATE ON parts
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS inventory_balances_set_updated_at ON inventory_balances;
CREATE TRIGGER inventory_balances_set_updated_at
BEFORE UPDATE ON inventory_balances
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS part_requests_set_updated_at ON part_requests;
CREATE TRIGGER part_requests_set_updated_at
BEFORE UPDATE ON part_requests
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS stock_movements_set_updated_at ON stock_movements;
CREATE TRIGGER stock_movements_set_updated_at
BEFORE UPDATE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

COMMIT;
