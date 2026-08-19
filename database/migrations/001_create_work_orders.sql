BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Kolom asal Spreadsheet "Kerja".
  ordered_at timestamptz NOT NULL DEFAULT now(),
  requester_department text NOT NULL,
  requester_name text NOT NULL,
  assigned_department text,
  machine_category text NOT NULL,
  machine_type text NOT NULL,
  machine_name text NOT NULL,
  job_type text NOT NULL,
  problem_description text NOT NULL,
  urgency text NOT NULL,
  repair_action text,
  machine_status text,
  started_at timestamptz,
  finished_at timestamptz,
  total_hours numeric(10, 2),
  order_status text NOT NULL DEFAULT 'Open',
  repair_rating text,
  spare_part_name text,
  spare_part_size text,
  notes text,

  -- Diisi saat migrasi untuk melacak baris lama tanpa menjadikannya ID utama.
  legacy_sheet_row integer UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT work_orders_total_hours_nonnegative
    CHECK (total_hours IS NULL OR total_hours >= 0),
  CONSTRAINT work_orders_time_order
    CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  CONSTRAINT work_orders_status_not_blank
    CHECK (btrim(order_status) <> '')
);

CREATE INDEX IF NOT EXISTS work_orders_status_ordered_at_idx
  ON work_orders (order_status, ordered_at DESC);

CREATE INDEX IF NOT EXISTS work_orders_machine_name_idx
  ON work_orders (machine_name);

CREATE INDEX IF NOT EXISTS work_orders_assigned_department_idx
  ON work_orders (assigned_department);

CREATE OR REPLACE FUNCTION set_work_orders_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_orders_set_updated_at ON work_orders;
CREATE TRIGGER work_orders_set_updated_at
BEFORE UPDATE ON work_orders
FOR EACH ROW
EXECUTE FUNCTION set_work_orders_updated_at();

COMMENT ON TABLE work_orders IS
  'Order kerja SiTeki; pengganti sumber utama tab Kerja di Google Sheets.';

COMMENT ON COLUMN work_orders.legacy_sheet_row IS
  'Nomor baris lama pada Google Sheets, hanya untuk rekonsiliasi selama migrasi.';

COMMIT;
