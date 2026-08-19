BEGIN;

WITH unique_plans AS (
  SELECT
    planned_on,
    lower(btrim(coalesce(machine_type, ''))) AS machine_type_key,
    lower(btrim(machine_name)) AS machine_name_key,
    lower(btrim(coalesce(schedule_code, ''))) AS schedule_code_key,
    (array_agg(id ORDER BY id))[1] AS plan_id
  FROM maintenance_plans
  GROUP BY
    planned_on,
    lower(btrim(coalesce(machine_type, ''))),
    lower(btrim(machine_name)),
    lower(btrim(coalesce(schedule_code, '')))
  HAVING count(*) = 1
)
UPDATE maintenance_inspections inspection
SET plan_id = plan.plan_id
FROM unique_plans plan
WHERE inspection.plan_id IS NULL
  AND inspection.inspected_on = plan.planned_on
  AND lower(btrim(coalesce(inspection.machine_type, ''))) = plan.machine_type_key
  AND lower(btrim(inspection.machine_name)) = plan.machine_name_key
  AND lower(btrim(coalesce(inspection.schedule_code, ''))) = plan.schedule_code_key;

COMMIT;
