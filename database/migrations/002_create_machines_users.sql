BEGIN;

CREATE TABLE IF NOT EXISTS machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text,
  machine_type text,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  legacy_sheet_row integer UNIQUE,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT machines_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS machines_category_type_name_idx
  ON machines (category, machine_type, name);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text,
  must_change_password boolean NOT NULL DEFAULT true,
  login_enabled boolean NOT NULL DEFAULT true,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'Lainnya',
  function_name text,
  employee_number text,
  job_title text,
  department text,
  team text,
  joined_on date,
  tenure_display text,
  last_contract_on date,
  education text,
  major text,
  employment_status text,
  salary_status text,
  allowance text,
  birth_place text,
  birth_date date,
  age_display text,
  address text,
  phone text,
  emergency_phone text,
  base_salary numeric(16, 2),
  daily_salary numeric(16, 2),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  legacy_sheet_row integer UNIQUE,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_not_blank CHECK (btrim(username) <> ''),
  CONSTRAINT users_full_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT users_base_salary_nonnegative
    CHECK (base_salary IS NULL OR base_salary >= 0),
  CONSTRAINT users_daily_salary_nonnegative
    CHECK (daily_salary IS NULL OR daily_salary >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_active_login_username_idx
  ON users (lower(username))
  WHERE login_enabled;

CREATE INDEX IF NOT EXISTS users_role_department_idx
  ON users (role, department);

CREATE OR REPLACE FUNCTION set_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS machines_set_updated_at ON machines;
CREATE TRIGGER machines_set_updated_at
BEFORE UPDATE ON machines
FOR EACH ROW
EXECUTE FUNCTION set_row_updated_at();

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_row_updated_at();

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES machines(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS work_orders_machine_id_idx
  ON work_orders (machine_id);

COMMENT ON COLUMN users.password_hash IS
  'Hash bcrypt; password asli dari spreadsheet tidak disimpan di PostgreSQL.';

COMMENT ON COLUMN users.must_change_password IS
  'Wajib true untuk akun hasil migrasi sampai pengguna mengganti password.';

COMMIT;
