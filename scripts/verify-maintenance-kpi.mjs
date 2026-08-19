import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;

const envContents = await readFile(path.join(process.cwd(), ".env"), "utf8");
const envLine = envContents.split(/\r?\n/).find((line) => /^\s*DATABASE_URL\s*=/.test(line));
if (!envLine) throw new Error("DATABASE_URL tidak ditemukan.");
const connectionString = envLine
  .replace(/^\s*DATABASE_URL\s*=\s*/, "")
  .trim()
  .replace(/^(['"])(.*)\1$/, "$2");

const client = new Client({ connectionString });
try {
  await client.connect();
  const result = await client.query(`
    SELECT
      to_char(month, 'YYYY-MM-DD') AS month,
      achievement_ratio::float8,
      target_ratio::float8,
      planned_count,
      inspection_count,
      target_inspection_count
    FROM monthly_maintenance_kpi
    ORDER BY month
  `);
  const mismatches = result.rows.filter((row) => {
    const expected = row.inspection_count / row.target_inspection_count;
    return Math.abs(row.achievement_ratio - expected) > 0.0000001;
  });
  if (mismatches.length) {
    console.error(JSON.stringify(mismatches, null, 2));
    throw new Error(`${mismatches.length} nilai KPI tidak berasal dari data pemeriksaan aktual.`);
  }

  const actualTotal = result.rows.reduce((total, row) => total + row.inspection_count, 0);
  const nonZeroKpi = result.rows.filter((row) => row.achievement_ratio > 0).length;
  if (actualTotal === 0 && nonZeroKpi !== 0) {
    throw new Error("Grafik KPI masih berisi nilai saat data pemeriksaan kosong.");
  }
  console.log(
    `Verifikasi KPI perawatan berhasil: ${actualTotal} pemeriksaan aktual, ${nonZeroKpi} bulan berisi grafik.`,
  );
} finally {
  await client.end().catch(() => {});
}
