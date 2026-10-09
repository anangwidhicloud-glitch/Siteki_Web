-- 036_granular_monitoring_signals.sql
-- Menambahkan granular change version per modul di database untuk efisiensi bandwidth

ALTER TABLE monitoring_change_state
  ADD COLUMN IF NOT EXISTS version_orders bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS version_reports bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS version_maintenance bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS version_overtime bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS version_electricity bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS version_inventory bigint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION bump_granular_monitoring_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_module text := TG_ARGV[0];
BEGIN
  INSERT INTO monitoring_change_state (id, version, changed_at)
  VALUES (1, 1, clock_timestamp())
  ON CONFLICT (id) DO UPDATE
  SET version = monitoring_change_state.version + 1,
      changed_at = excluded.changed_at,
      version_orders = CASE WHEN target_module = 'orders' THEN monitoring_change_state.version_orders + 1 ELSE monitoring_change_state.version_orders END,
      version_reports = CASE WHEN target_module = 'reports' THEN monitoring_change_state.version_reports + 1 ELSE monitoring_change_state.version_reports END,
      version_maintenance = CASE WHEN target_module = 'maintenance' THEN monitoring_change_state.version_maintenance + 1 ELSE monitoring_change_state.version_maintenance END,
      version_overtime = CASE WHEN target_module = 'overtime' THEN monitoring_change_state.version_overtime + 1 ELSE monitoring_change_state.version_overtime END,
      version_electricity = CASE WHEN target_module = 'electricity' THEN monitoring_change_state.version_electricity + 1 ELSE monitoring_change_state.version_electricity END,
      version_inventory = CASE WHEN target_module = 'inventory' THEN monitoring_change_state.version_inventory + 1 ELSE monitoring_change_state.version_inventory END;
  RETURN NULL;
END;
$$;

-- Pasang trigger per-modul ke tabel masing-masing
DO $$
BEGIN
  -- 1. Orders
  IF to_regclass('public.work_orders') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS monitoring_change_signal ON public.work_orders;
    CREATE TRIGGER monitoring_change_signal
      AFTER INSERT OR UPDATE OR DELETE ON public.work_orders
      FOR EACH STATEMENT EXECUTE FUNCTION bump_granular_monitoring_change('orders');
  END IF;

  -- 2. Reports
  IF to_regclass('public.work_reports') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS monitoring_change_signal ON public.work_reports;
    CREATE TRIGGER monitoring_change_signal
      AFTER INSERT OR UPDATE OR DELETE ON public.work_reports
      FOR EACH STATEMENT EXECUTE FUNCTION bump_granular_monitoring_change('reports');
  END IF;

  -- 3. Maintenance
  IF to_regclass('public.maintenance_plans') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS monitoring_change_signal ON public.maintenance_plans;
    CREATE TRIGGER monitoring_change_signal
      AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_plans
      FOR EACH STATEMENT EXECUTE FUNCTION bump_granular_monitoring_change('maintenance');
  END IF;
  IF to_regclass('public.maintenance_inspections') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS monitoring_change_signal ON public.maintenance_inspections;
    CREATE TRIGGER monitoring_change_signal
      AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_inspections
      FOR EACH STATEMENT EXECUTE FUNCTION bump_granular_monitoring_change('maintenance');
  END IF;

  -- 4. Overtime
  IF to_regclass('public.overtime_entries') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS monitoring_change_signal ON public.overtime_entries;
    CREATE TRIGGER monitoring_change_signal
      AFTER INSERT OR UPDATE OR DELETE ON public.overtime_entries
      FOR EACH STATEMENT EXECUTE FUNCTION bump_granular_monitoring_change('overtime');
  END IF;

  -- 5. Electricity
  IF to_regclass('public.electricity_checks') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS monitoring_change_signal ON public.electricity_checks;
    CREATE TRIGGER monitoring_change_signal
      AFTER INSERT OR UPDATE OR DELETE ON public.electricity_checks
      FOR EACH STATEMENT EXECUTE FUNCTION bump_granular_monitoring_change('electricity');
  END IF;
  IF to_regclass('public.electricity_power_factor_readings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS monitoring_change_signal ON public.electricity_power_factor_readings;
    CREATE TRIGGER monitoring_change_signal
      AFTER INSERT OR UPDATE OR DELETE ON public.electricity_power_factor_readings
      FOR EACH STATEMENT EXECUTE FUNCTION bump_granular_monitoring_change('electricity');
  END IF;

  -- 6. Inventory & Bon
  IF to_regclass('public.part_requests') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS monitoring_change_signal ON public.part_requests;
    CREATE TRIGGER monitoring_change_signal
      AFTER INSERT OR UPDATE OR DELETE ON public.part_requests
      FOR EACH STATEMENT EXECUTE FUNCTION bump_granular_monitoring_change('inventory');
  END IF;
  IF to_regclass('public.inventory_balances') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS monitoring_change_signal ON public.inventory_balances;
    CREATE TRIGGER monitoring_change_signal
      AFTER INSERT OR UPDATE OR DELETE ON public.inventory_balances
      FOR EACH STATEMENT EXECUTE FUNCTION bump_granular_monitoring_change('inventory');
  END IF;
END;
$$;
