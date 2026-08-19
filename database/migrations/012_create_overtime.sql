BEGIN;

CREATE OR REPLACE FUNCTION round_overtime_component(
  base_salary numeric,
  multiplier numeric,
  overtime_hours numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(base_salary, 0) <= 0 OR coalesce(overtime_hours, 0) <= 0 THEN 0
    ELSE ceil(round(multiplier * 0.005781035 * base_salary * overtime_hours) / 50) * 50
  END;
$$;

CREATE OR REPLACE FUNCTION calculate_overtime_wage(
  base_salary numeric,
  overtime_hours numeric,
  overtime_type text
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(replace(coalesce(overtime_type, ''), '_', '')) = 'haribesar'
      THEN round_overtime_component(base_salary, 2, overtime_hours)
    WHEN coalesce(overtime_hours, 0) > 1
      THEN round_overtime_component(base_salary, 1.5, 1) +
        round_overtime_component(base_salary, 2, overtime_hours - 1)
    ELSE round_overtime_component(base_salary, 1.5, overtime_hours)
  END;
$$;

CREATE TABLE IF NOT EXISTS overtime_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  recorded_at timestamptz,
  overtime_date date NOT NULL,
  employee_name text NOT NULL,
  role_snapshot text,
  overtime_hours numeric(8, 2) NOT NULL,
  overtime_type text NOT NULL,
  hourly_salary_snapshot numeric(16, 4),
  total_wage numeric(16, 2),
  notes text,
  wage_anomaly boolean NOT NULL DEFAULT false,
  salary_reference_anomaly boolean NOT NULL DEFAULT false,
  source_sheet text NOT NULL DEFAULT 'Database_Lembur',
  legacy_sheet_row integer NOT NULL,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT overtime_entries_source_row_unique
    UNIQUE (source_sheet, legacy_sheet_row)
);

CREATE INDEX IF NOT EXISTS overtime_entries_user_date_idx
  ON overtime_entries (user_id, overtime_date DESC);
CREATE INDEX IF NOT EXISTS overtime_entries_payroll_date_idx
  ON overtime_entries (overtime_date);
CREATE INDEX IF NOT EXISTS overtime_entries_anomaly_idx
  ON overtime_entries (wage_anomaly, salary_reference_anomaly)
  WHERE wage_anomaly OR salary_reference_anomaly;

CREATE OR REPLACE VIEW overtime_entry_calculations AS
SELECT
  entry.*,
  calculate_overtime_wage(
    user_profile.base_salary,
    entry.overtime_hours,
    entry.overtime_type
  ) AS calculated_wage,
  entry.total_wage - calculate_overtime_wage(
    user_profile.base_salary,
    entry.overtime_hours,
    entry.overtime_type
  ) AS wage_difference
FROM overtime_entries entry
LEFT JOIN users user_profile ON user_profile.id = entry.user_id;

CREATE OR REPLACE VIEW monthly_overtime_payroll AS
SELECT
  CASE
    WHEN extract(day FROM overtime_date) >= 22
      THEN (date_trunc('month', overtime_date) + interval '1 month')::date
    ELSE date_trunc('month', overtime_date)::date
  END AS payroll_month,
  user_id,
  employee_name,
  count(*)::integer AS entry_count,
  sum(overtime_hours)::numeric(16, 2) AS total_hours,
  sum(total_wage)::numeric(18, 2) AS total_wage,
  min(
    CASE WHEN extract(day FROM overtime_date) >= 22
      THEN date_trunc('month', overtime_date)::date + 21
      ELSE (date_trunc('month', overtime_date) - interval '1 month')::date + 21
    END
  ) AS cutoff_start,
  max(
    CASE WHEN extract(day FROM overtime_date) >= 22
      THEN (date_trunc('month', overtime_date) + interval '1 month')::date + 20
      ELSE date_trunc('month', overtime_date)::date + 20
    END
  ) AS cutoff_end
FROM overtime_entries
GROUP BY
  CASE
    WHEN extract(day FROM overtime_date) >= 22
      THEN (date_trunc('month', overtime_date) + interval '1 month')::date
    ELSE date_trunc('month', overtime_date)::date
  END,
  user_id,
  employee_name;

DROP TRIGGER IF EXISTS overtime_entries_set_updated_at ON overtime_entries;
CREATE TRIGGER overtime_entries_set_updated_at
BEFORE UPDATE ON overtime_entries
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

COMMIT;
