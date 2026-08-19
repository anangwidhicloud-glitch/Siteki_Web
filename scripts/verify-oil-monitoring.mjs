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
      (SELECT count(*)::integer FROM oil_reservoirs) AS reservoir_count,
      (SELECT count(*)::integer FROM oil_reservoirs WHERE machine_id IS NOT NULL) AS linked_machine_count,
      (SELECT count(*)::integer FROM oil_reservoirs WHERE capacity_anomaly) AS capacity_anomaly_count,
      (SELECT count(*)::integer FROM oil_checks) AS check_count,
      (SELECT count(DISTINCT reservoir_id)::integer FROM oil_checks) AS checked_reservoir_count,
      (SELECT count(*)::integer FROM oil_checks WHERE reservoir_id IS NULL) AS unmatched_reservoir_count,
      (SELECT count(*)::integer FROM oil_checks WHERE level_percent NOT BETWEEN 0 AND 100) AS invalid_level_count,
      (SELECT count(*)::integer FROM oil_reservoirs WHERE legacy_data = '{}'::jsonb) AS missing_reservoir_source,
      (SELECT count(*)::integer FROM oil_checks WHERE legacy_data = '{}'::jsonb) AS missing_check_source
  `);
  const row = result.rows[0];
  if (row.reservoir_count !== 31 || row.check_count !== 162 || row.checked_reservoir_count !== 31) {
    throw new Error("Jumlah master atau riwayat cek oli tidak sesuai sumber.");
  }
  if (
    row.capacity_anomaly_count || row.unmatched_reservoir_count || row.invalid_level_count ||
    row.missing_reservoir_source || row.missing_check_source
  ) throw new Error("Relasi, kapasitas, level, atau metadata sumber cek oli tidak konsisten.");
  console.log(
    `Verifikasi cek oli: ${row.reservoir_count} reservoir, ${row.check_count} pemeriksaan, seluruh reservoir memiliki riwayat.`,
  );
  console.log(
    `${row.linked_machine_count} reservoir terhubung master mesin; sisanya dipertahankan sebagai titik/sub-tangki oli.`,
  );
} finally {
  await client.end().catch(() => {});
}
