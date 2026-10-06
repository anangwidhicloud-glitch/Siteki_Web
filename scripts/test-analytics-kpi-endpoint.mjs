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

  const rows = await client.query("SELECT * FROM monthly_maintenance_kpi ORDER BY month");

  function shortMonth(value) {
    const key = new Date(value).toISOString().slice(0, 10);
    return new Intl.DateTimeFormat("id-ID", { month: "short", timeZone: "UTC" })
      .format(new Date(`${key}T00:00:00Z`)).replace(".", "");
  }

  const result = rows.rows.map(row => ({
    bulan: shortMonth(row.month),
    pencapaian: Number(row.achievement_ratio || 0),
    target: Number(row.target_ratio || 0.8),
    bagus: row.good_count || 0,
    perlu_perbaikan: row.repair_needed_count || 0,
    rencana: row.planned_count || 0,
    aktual: row.inspection_count || 0,
    target_jumlah: row.target_inspection_count || 268,
  }));

  console.log("=== OUTPUT OF ENDPOINTS.kpi ===");
  result.forEach(r => {
    console.log(`Bulan: ${r.bulan} | Pencapaian: ${(r.pencapaian * 100).toFixed(1)}% (Value in Chart: ${Math.round(r.pencapaian * 100)}) | Aktual: ${r.aktual} | Target: ${r.target_jumlah}`);
  });

  await client.end();
}

run().catch(console.error);
