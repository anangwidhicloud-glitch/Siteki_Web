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

  console.log("=== MONTHLY MAINTENANCE KPI TABLE ===");
  const kpiRes = await client.query("SELECT * FROM monthly_maintenance_kpi ORDER BY month");
  kpiRes.rows.forEach(r => {
    const mStr = new Date(r.month).toISOString().slice(0, 7);
    console.log(`Bulan: ${mStr} | Ratio: ${Number(r.achievement_ratio || 0) * 100}% | Rencana: ${r.planned_count} | Aktual: ${r.inspection_count} | Target: ${r.target_inspection_count}`);
  });

  console.log("\n=== MAINTENANCE PLANS IN JULY 2026 ===");
  const plansRes = await client.query(`
    SELECT planned_on, schedule_code, machine_name, maintenance_type
    FROM maintenance_plans
    WHERE planned_on >= '2026-07-01' AND planned_on <= '2026-07-31'
    ORDER BY planned_on, machine_name
  `);
  console.log(`Total Rencana Juli 2026 (Plans): ${plansRes.rows.length}`);

  console.log("\n=== MAINTENANCE INSPECTIONS IN JULY 2026 ===");
  const inspRes = await client.query(`
    SELECT inspected_on, schedule_code, machine_name, maintenance_type
    FROM maintenance_inspections
    WHERE inspected_on >= '2026-07-01' AND inspected_on <= '2026-07-31'
    ORDER BY inspected_on, machine_name
  `);
  console.log(`Total Inspections Aktual Juli 2026: ${inspRes.rows.length}`);

  // Find plans that don't have matching inspections
  if (plansRes.rows.length > 0) {
    const inspMap = new Map();
    inspRes.rows.forEach(i => {
      const key = `${i.machine_name.toLowerCase().trim()}|${(i.schedule_code||"").toUpperCase()}`;
      inspMap.set(key, (inspMap.get(key) || 0) + 1);
    });

    const missing = [];
    plansRes.rows.forEach(p => {
      const key = `${p.machine_name.toLowerCase().trim()}|${(p.schedule_code||"").toUpperCase()}`;
      if (!inspMap.has(key) || inspMap.get(key) <= 0) {
        missing.push(p);
      } else {
        inspMap.set(key, inspMap.get(key) - 1);
      }
    });

    console.log(`\nRencana Perawatan yang BELUM/TIDAK Terisi di Juli 2026 (${missing.length} item):`);
    missing.forEach(m => {
      console.log(`  - Tanggal: ${new Date(m.planned_on).toISOString().slice(0, 10)} | Mesin: ${m.machine_name} (${m.schedule_code || m.maintenance_type})`);
    });
  }

  await client.end();
}

run().catch(console.error);
