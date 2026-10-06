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

  console.log("=== MAINTENANCE MONTHLY TARGETS TABLE ===");
  const targetsRes = await client.query("SELECT * FROM maintenance_monthly_targets ORDER BY month");
  targetsRes.rows.forEach(t => {
    console.log(`Month: ${new Date(t.month).toISOString().slice(0, 10)} | Target Count: ${t.target_inspection_count} | Target Ratio: ${t.target_ratio}`);
  });

  console.log("\n=== CHECKING PAST BACKUP FOR JULY / JUNE INSPECTIONS ===");
  const backupPath = path.join(process.cwd(), ".deploy-backups", "maintenance-tables-backup-2026-09-25T18-11-20-046Z.json");
  const backupStr = await readFile(backupPath, "utf8");
  const backupData = JSON.parse(backupStr);

  const inspections = backupData.maintenance_inspections || [];
  console.log(`Total Backed Up Inspections: ${inspections.length}`);

  const byMonth = {};
  inspections.forEach(i => {
    const mKey = new Date(i.inspected_on).toISOString().slice(0, 7);
    if (!byMonth[mKey]) byMonth[mKey] = [];
    byMonth[mKey].push(i);
  });

  for (const [m, rows] of Object.entries(byMonth)) {
    console.log(`Bulan ${m}: ${rows.length} pemeriksaan aktual`);
  }

  // Check unique machines in July/June in backup
  const juneRows = byMonth["2026-06"] || [];
  const juneMachines = new Set(juneRows.map(r => `${r.machine_name}|${r.schedule_code}`));
  console.log(`\nJuni 2026: ${juneRows.length} pemeriksaan dari ${juneMachines.size} pasang mesin/jadwal.`);

  const julyRows = byMonth["2026-07"] || [];
  const julyMachines = new Set(julyRows.map(r => `${r.machine_name}|${r.schedule_code}`));
  console.log(`Juli 2026: ${julyRows.length} pemeriksaan dari ${julyMachines.size} pasang mesin/jadwal.`);

  await client.end();
}

run().catch(console.error);
