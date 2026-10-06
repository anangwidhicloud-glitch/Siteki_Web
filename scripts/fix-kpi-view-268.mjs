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

  console.log("=== APPLYING ACCURATE 268 TARGET KPI VIEW ===");

  await client.query("UPDATE maintenance_monthly_targets SET target_inspection_count = 268");

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
  console.log("View updated successfully!");

  // Also check if we should restore the historical inspection records so the charts show actual historical data!
  const inspCount = await client.query("SELECT count(*)::integer FROM maintenance_inspections");
  console.log("Current maintenance_inspections count in DB:", inspCount.rows[0].count);

  if (inspCount.rows[0].count === 0) {
    console.log("Restoring historical inspections from backup so KPI charts display accurately...");
    const backupPath = path.join(process.cwd(), ".deploy-backups", "maintenance-tables-backup-2026-09-25T18-11-20-046Z.json");
    const backupStr = await readFile(backupPath, "utf8");
    const backupData = JSON.parse(backupStr);
    const inspections = backupData.maintenance_inspections || [];
    const results = backupData.maintenance_check_results || [];

    console.log(`Restoring ${inspections.length} inspections...`);
    
    // Batch insert inspections
    for (const i of inspections) {
      await client.query(`
        INSERT INTO maintenance_inspections (id, plan_id, machine_id, inspected_on, machine_category, machine_type, machine_name, schedule_code, maintenance_type, notes, source_sheet, legacy_sheet_row, legacy_data, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO NOTHING
      `, [i.id, i.plan_id, i.machine_id, i.inspected_on, i.machine_category, i.machine_type, i.machine_name, i.schedule_code, i.maintenance_type, i.notes, i.source_sheet, i.legacy_sheet_row, JSON.stringify(i.legacy_data || {}), i.created_at, i.updated_at]);
    }

    console.log(`Restoring ${results.length} check results...`);
    for (const r of results) {
      await client.query(`
        INSERT INTO maintenance_check_results (id, inspection_id, item_id, status, raw_status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [r.id, r.inspection_id, r.item_id, r.status, r.raw_status, r.created_at, r.updated_at]);
    }

    console.log("Historical data restored successfully!");
  }

  console.log("\n=== HASIL KPI BULANAN SETELAH PERBAIKAN ===");
  const kpiRows = await client.query("SELECT * FROM monthly_maintenance_kpi ORDER BY month");
  kpiRows.rows.forEach(r => {
    const m = new Date(r.month).toISOString().slice(0, 7);
    const pct = (Number(r.achievement_ratio) * 100).toFixed(1);
    console.log(`Bulan ${m} -> Aktual: ${r.inspection_count} / Target: ${r.target_inspection_count} => KPI: ${pct}%`);
  });

  await client.end();
}

run().catch(console.error);
