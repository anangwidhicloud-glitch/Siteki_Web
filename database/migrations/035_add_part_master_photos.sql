BEGIN;

ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS photo_public_id text,
  ADD COLUMN IF NOT EXISTS photo_bytes integer,
  ADD COLUMN IF NOT EXISTS photo_width integer,
  ADD COLUMN IF NOT EXISTS photo_height integer;

COMMIT;
