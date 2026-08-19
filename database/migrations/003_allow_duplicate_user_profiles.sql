BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_username_key;

DROP INDEX IF EXISTS users_username_case_insensitive_idx;

CREATE UNIQUE INDEX IF NOT EXISTS users_active_login_username_idx
  ON users (lower(username))
  WHERE login_enabled;

COMMENT ON COLUMN users.login_enabled IS
  'Hanya satu profil untuk setiap username yang boleh digunakan untuk login.';

COMMIT;
