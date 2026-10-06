BEGIN;

ALTER TABLE parts ADD COLUMN IF NOT EXISTS unit text;

UPDATE parts
SET unit=(
  SELECT inventory_balances.unit
  FROM inventory_balances
  WHERE inventory_balances.part_id=parts.id
    AND nullif(btrim(inventory_balances.unit),'') IS NOT NULL
  ORDER BY inventory_balances.updated_at DESC NULLS LAST
  LIMIT 1
)
WHERE nullif(btrim(parts.unit),'') IS NULL
  AND EXISTS (
    SELECT 1 FROM inventory_balances
    WHERE inventory_balances.part_id=parts.id
      AND nullif(btrim(inventory_balances.unit),'') IS NOT NULL
  );

COMMIT;
