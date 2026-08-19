BEGIN;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS machine_id uuid
    REFERENCES machines(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_name text NOT NULL DEFAULT 'Order API',
  ADD COLUMN IF NOT EXISTS legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS work_orders_machine_id_idx
  ON work_orders (machine_id, ordered_at DESC);

CREATE OR REPLACE VIEW work_order_summary AS
SELECT
  count(*)::integer AS total_orders,
  count(*) FILTER (WHERE lower(order_status) = 'open')::integer AS open_orders,
  count(*) FILTER (WHERE lower(order_status) <> 'open')::integer AS closed_orders,
  count(*) FILTER (WHERE machine_id IS NULL)::integer AS unmatched_machines,
  min(ordered_at) AS first_ordered_at,
  max(ordered_at) AS last_ordered_at
FROM work_orders;

COMMENT ON COLUMN work_orders.source_name IS
  'Sumber saat migrasi; Order API adalah endpoint aktif yang digunakan aplikasi lama.';

COMMIT;
