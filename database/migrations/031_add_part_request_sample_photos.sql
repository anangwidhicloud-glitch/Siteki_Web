BEGIN;

ALTER TABLE part_requests
  ADD COLUMN IF NOT EXISTS sample_photo_url text,
  ADD COLUMN IF NOT EXISTS sample_photo_public_id text,
  ADD COLUMN IF NOT EXISTS sample_photo_bytes integer,
  ADD COLUMN IF NOT EXISTS sample_photo_width integer,
  ADD COLUMN IF NOT EXISTS sample_photo_height integer;

COMMIT;
