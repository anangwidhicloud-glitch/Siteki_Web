import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

async function run() {
  const envContents = await readFile(path.join(process.cwd(), ".env"), "utf8");
  const envLine = envContents.split(/\r?\n/).find((line) => /^\s*DATABASE_URL\s*=/.test(line));
  if (!envLine) throw new Error("DATABASE_URL tidak ditemukan.");
  const connectionString = envLine
    .replace(/^\s*DATABASE_URL\s*=\s*/, "")
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");

  const client = new pg.Client({ connectionString });
  await client.connect();

  console.log("=== APPLYING UPDATED VIEW MIGRATION FOR KPI RATIO ===");

  const sqlMigration = `
    CREATE OR REPLACE VIEW monthly_maintenance_kpi AS
    WITH check_summary AS (
      SELECT
        date_trunc('month', inspection.inspected_on)::date AS month,
        count(*) FILTER (WHERE result.status = 'good')::integer AS good_count,
        count(*) FILTER (WHERE result.status = 'repair_needed')::integer AS repair_needed_count
      FROM maintenance_inspections inspection
      JOIN maintenance_check_results result ON result.inspection_id = inspection.id
      GROUP BY date_trunc('month', inspection.inspected_on)::date
    ), plan_summary AS (
      SELECT date_trunc('month', planned_on)::date AS month, count(*)::integer AS planned_count
      FROM maintenance_plans
      GROUP BY date_trunc('month', planned_on)::date
    ), inspection_summary AS (
      SELECT date_trunc('month', inspected_on)::date AS month, count(*)::integer AS inspection_count
      FROM maintenance_inspections
      GROUP BY date_trunc('month', inspected_on)::date
    )
    SELECT
      target.month,
      CASE
        WHEN coalesce(plans.planned_count, 0) > 0 THEN
          LEAST(1.0, coalesce(inspections.inspection_count, 0)::numeric / plans.planned_count::numeric)
        WHEN target.target_inspection_count > 0 THEN
          LEAST(1.0, coalesce(inspections.inspection_count, 0)::numeric / target.target_inspection_count::numeric)
        ELSE 0.0
      END AS achievement_ratio,
      target.target_ratio,
      coalesce(checks.good_count, 0) AS good_count,
      coalesce(checks.repair_needed_count, 0) AS repair_needed_count,
      coalesce(plans.planned_count, 0) AS planned_count,
      coalesce(inspections.inspection_count, 0) AS inspection_count,
      COALESCE(NULLIF(plans.planned_count, 0), target.target_inspection_count) AS target_inspection_count
    FROM maintenance_monthly_targets target
    LEFT JOIN check_summary checks USING (month)
    LEFT JOIN plan_summary plans USING (month)
    LEFT JOIN inspection_summary inspections USING (month);
  `;

  await client.query(sqlMigration);
  console.log("Migration view executed successfully!");

  console.log("\n=== TESTING KPI RATIO RESULT ===");
  const res = await client.query("SELECT * FROM monthly_maintenance_kpi ORDER BY month");
  res.rows.forEach(r => {
    const mStr = new Date(r.month).toISOString().slice(0, 7);
    const pct = (Number(r.achievement_ratio) * 100).toFixed(1);
    console.log(`Bulan ${mStr} -> Ratio: ${pct}% | Rencana (P): ${r.planned_count} | Aktual: ${r.inspection_count} | Target: ${r.target_inspection_count}`);
  });

  await client.end();
}

run().catch(console.error);
