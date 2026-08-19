CREATE TABLE IF NOT EXISTS monitoring_change_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version bigint NOT NULL DEFAULT 0,
  changed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO monitoring_change_state (id, version)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION bump_monitoring_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO monitoring_change_state (id, version, changed_at)
  VALUES (1, 1, clock_timestamp())
  ON CONFLICT (id) DO UPDATE
  SET version = monitoring_change_state.version + 1,
      changed_at = excluded.changed_at;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  monitored_table text;
  monitored_tables text[] := ARRAY[
    'work_orders', 'work_reports', 'maintenance_plans', 'maintenance_inspections',
    'overtime_entries', 'inventory_balances', 'part_requests',
    'electricity_checks', 'electricity_power_factor_readings'
  ];
BEGIN
  FOREACH monitored_table IN ARRAY monitored_tables LOOP
    IF to_regclass('public.' || monitored_table) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS monitoring_change_signal ON %I', monitored_table);
      EXECUTE format(
        'CREATE TRIGGER monitoring_change_signal AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION bump_monitoring_change()',
        monitored_table
      );
    END IF;
  END LOOP;
END;
$$;
