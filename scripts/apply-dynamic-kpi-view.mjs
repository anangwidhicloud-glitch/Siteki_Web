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

  console.log("=== UPDATING TARGET INSPECTION COUNT TO 268 (67 MACHINES x 4) ===");
  await client.query("UPDATE maintenance_monthly_targets SET target_inspection_count = 268");

  console.log("=== UPDATING MONTHLY MAINTENANCE KPI VIEW ===");

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
    ), inspection_summary AS (
      SELECT
        date_trunc('month', inspected_on)::date AS month,
        count(*)::integer AS inspection_count
      FROM maintenance_inspections
      GROUP BY date_trunc('month', inspected_on)::date
    )
    SELECT
      target.month,
      LEAST(1.0, GREATEST(0.0, coalesce(inspections.inspection_count, 0)::numeric / target.target_inspection_count::numeric)) AS achievement_ratio,
      target.target_ratio,
      coalesce(checks.good_count, 0) AS good_count,
      coalesce(checks.repair_needed_count, 0) AS repair_needed_count,
      target.target_inspection_count AS planned_count,
      coalesce(inspections.inspection_count, 0) AS inspection_count,
      target.target_inspection_count
    FROM maintenance_monthly_targets target
    LEFT JOIN check_summary checks USING (month)
    LEFT JOIN inspection_summary inspections USING (month);
  `;

  await client.query(sqlMigration);
  console.log("VIEW updated successfully!");

  console.log("\n=== HASIL KALIBRASI KPI GRAFIK DENGAN DATA MASTER BACKUP ===");

  // Read backup file to simulate result on frontend API
  const backupPath = path.join(process.cwd(), ".deploy-backups", "maintenance-tables-backup-2026-09-25T18-11-20-046Z.json");
  const backupStr = await readFile(backupPath, "utf8");
  const backupData = JSON.parse(backupStr);
  const inspections = backupData.maintenance_inspections || [];

  const byMonth = {};
  inspections.forEach(i => {
    const m = new Date(i.inspected_on).toISOString().slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
  });

  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
  months.forEach(m => {
    const actual = byMonth[m] || 0;
    const ratio = ((actual / 268) * 100).toFixed(1);
    console.log(`Bulan ${m} -> Aktual: ${actual} / Target 268 -> Grafik KPI: ${ratio}%`);
  });

  await client.end();
}

run().catch(console.error);
