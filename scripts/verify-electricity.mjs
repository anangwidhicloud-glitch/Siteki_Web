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
      count(*)::integer AS check_count,
      count(*) FILTER (WHERE officer_id IS NULL)::integer AS unmatched_officers,
      count(*) FILTER (WHERE calculation_anomaly)::integer AS marked_anomalies,
      count(*) FILTER (
        WHERE abs(kwh - calculated_kwh) > 0.001
           OR abs(kvar - calculated_kvar) > 0.001
           OR abs(difference - calculated_difference) > 0.001
           OR lower(conclusion) <> lower(calculated_conclusion)
      )::integer AS calculated_anomalies
    FROM electricity_check_calculations
  `);
  const summary = result.rows[0];
  if (summary.marked_anomalies !== summary.calculated_anomalies) {
    throw new Error("Penanda anomali listrik tidak konsisten dengan SQL View.");
  }
  console.log(
    `Verifikasi listrik: ${summary.check_count} pemeriksaan, ${summary.unmatched_officers} tanpa petugas, ${summary.marked_anomalies} anomali.`,
  );
  if (summary.unmatched_officers) {
    const unmatched = await client.query(`
      SELECT officer_name, count(*)::integer AS check_count
      FROM electricity_checks
      WHERE officer_id IS NULL
      GROUP BY officer_name
      ORDER BY check_count DESC, officer_name
    `);
    console.log(
      `Nama belum terhubung: ${unmatched.rows.map((row) => `${row.officer_name} (${row.check_count})`).join(", ")}.`,
    );
  }
} finally {
  await client.end().catch(() => {});
}
