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

  console.log("=== VERIFIKASI PERHITUNGAN KPI UNTUK SEMUA BULAN SEBELUMNYA ===");
  const res = await client.query("SELECT * FROM monthly_maintenance_kpi ORDER BY month");
  
  res.rows.forEach(r => {
    const mStr = new Date(r.month).toISOString().slice(0, 7);
    const pct = (Number(r.achievement_ratio) * 100).toFixed(1);
    console.log(`Bulan ${mStr} -> Pencapaian: ${pct}% | Rencana (P): ${r.planned_count} | Aktual (A): ${r.inspection_count} | Target: ${r.target_inspection_count}`);
  });

  await client.end();
}

run().catch(console.error);
