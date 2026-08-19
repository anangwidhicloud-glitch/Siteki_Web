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
      summary.*,
      (SELECT count(*)::integer FROM stang_brands WHERE is_active) AS active_brands,
      (SELECT count(*)::integer FROM stang_groups WHERE is_active) AS active_groups,
      (SELECT count(*)::integer FROM stang_locations WHERE is_active) AS active_locations,
      (SELECT count(*)::integer FROM stang_transactions WHERE issued_group_id IS NULL AND issued_by_name IS NOT NULL AND issued_by_name <> '-') AS unmatched_issued_groups,
      (SELECT count(*)::integer FROM stang_transactions WHERE brand_id IS NULL AND brand_name IS NOT NULL AND brand_name <> '-') AS unmatched_brands,
      (SELECT count(*)::integer FROM stang_transaction_status WHERE duration_days IS DISTINCT FROM calculated_duration_days AND returned_on IS NOT NULL) AS duration_anomalies,
      (SELECT count(*)::integer FROM stang_transactions WHERE returned_on < issued_on OR duration_days < 0) AS negative_duration_anomalies,
      (SELECT count(*)::integer FROM stang_transactions WHERE data_anomaly) AS marked_anomalies
    FROM stang_summary summary
  `);
  const row = result.rows[0];
  if (row.total_issued !== 2026 || row.total_returned + row.total_open !== row.total_issued) {
    throw new Error("Jumlah transaksi Stang tidak konsisten.");
  }
  if (row.unmatched_issued_groups || row.unmatched_brands || row.duration_anomalies) {
    throw new Error("Relasi atau durasi transaksi Stang tidak konsisten.");
  }
  console.log(
    `Verifikasi Stang: ${row.total_issued} transaksi (${row.total_returned} kembali, ${row.total_open} belum), ${row.missing_code_count} tanpa kode historis.`,
  );
  console.log(
    `Referensi aktif: ${row.active_brands} merk, ${row.active_groups} grup, ${row.active_locations} lokasi; ${row.marked_anomalies} baris sumber tidak lengkap.`,
  );
  if (row.negative_duration_anomalies) {
    console.log(`Catatan: ${row.negative_duration_anomalies} transaksi memiliki tanggal/durasi negatif dari sumber.`);
  }
} finally {
  await client.end().catch(() => {});
}
