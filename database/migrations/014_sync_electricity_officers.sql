BEGIN;

WITH unique_users AS (
  SELECT lower(btrim(full_name)) AS normalized_name, min(id::text)::uuid AS user_id
  FROM users
  GROUP BY lower(btrim(full_name))
  HAVING count(*) = 1
), missing_officers AS (
  SELECT DISTINCT ON (lower(btrim(checks.officer_name)))
    users.user_id,
    btrim(checks.officer_name) AS name
  FROM electricity_checks checks
  LEFT JOIN unique_users users
    ON users.normalized_name = lower(btrim(checks.officer_name))
  WHERE NOT EXISTS (
    SELECT 1
    FROM electricity_officers officers
    WHERE lower(btrim(officers.name)) = lower(btrim(checks.officer_name))
  )
  ORDER BY lower(btrim(checks.officer_name)), checks.checked_at
)
INSERT INTO electricity_officers (user_id, name)
SELECT user_id, name
FROM missing_officers
ON CONFLICT (name) DO NOTHING;

UPDATE electricity_checks checks
SET officer_id = officers.id
FROM electricity_officers officers
WHERE checks.officer_id IS NULL
  AND lower(btrim(officers.name)) = lower(btrim(checks.officer_name));

COMMIT;
