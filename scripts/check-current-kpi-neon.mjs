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

  console.log("=== CHECKING monthly_maintenance_kpi IN NEON DB ===");
  const res = await client.query("SELECT * FROM monthly_maintenance_kpi ORDER BY month");
  console.log("Total rows:", res.rows.length);
  res.rows.forEach(r => {
    console.log(JSON.stringify({
      month: r.month,
      achievement_ratio: r.achievement_ratio,
      pct: (Number(r.achievement_ratio) * 100).toFixed(1) + "%",
      target_ratio: r.target_ratio,
      good_count: r.good_count,
      repair_needed_count: r.repair_needed_count,
      planned_count: r.planned_count,
      inspection_count: r.inspection_count,
      target_inspection_count: r.target_inspection_count
    }));
  });

  await client.end();
}

run().catch(console.error);
