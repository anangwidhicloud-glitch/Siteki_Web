BEGIN;

-- Permen ESDM 7/2024 uses an average power-factor threshold of 0.85.
-- The equivalent reactive-energy threshold is approximately 0.62 x kWh.
CREATE OR REPLACE VIEW electricity_check_calculations AS
SELECT
  electricity_checks.*,
  (huhe_h - huhe_hh) * 0.62 AS calculated_kwh,
  huar_heh - huar_hh AS calculated_kvar,
  ((huhe_h - huhe_hh) * 0.62) - (huar_heh - huar_hh)
    AS calculated_difference,
  CASE
    WHEN huar_heh - huar_hh > (huhe_h - huhe_hh) * 0.62 THEN 'POTENSI DENDA'
    ELSE 'AMAN'
  END AS calculated_conclusion
FROM electricity_checks;

CREATE OR REPLACE VIEW latest_electricity_check AS
SELECT *
FROM electricity_check_calculations
ORDER BY checked_at DESC
LIMIT 1;

CREATE OR REPLACE VIEW monthly_electricity_summary AS
SELECT
  date_trunc('month', checked_at AT TIME ZONE 'Asia/Jakarta')::date AS month,
  count(*)::integer AS check_count,
  avg(calculated_kwh)::numeric(18, 6) AS average_kwh,
  avg(calculated_kvar)::numeric(18, 6) AS average_kvar,
  count(*) FILTER (
    WHERE calculated_conclusion = 'POTENSI DENDA'
  )::integer AS potential_penalty_count
FROM electricity_check_calculations
GROUP BY date_trunc('month', checked_at AT TIME ZONE 'Asia/Jakarta')::date;

COMMIT;
