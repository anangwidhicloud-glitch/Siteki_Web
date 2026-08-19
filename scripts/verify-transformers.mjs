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
      (SELECT count(*)::integer FROM welding_transformers) AS transformer_count,
      (SELECT count(*)::integer FROM welding_transformer_brands WHERE is_active) AS brand_count,
      (SELECT count(*)::integer FROM welding_transformer_locations WHERE is_active) AS location_count,
      summary.*,
      (SELECT count(*)::integer FROM welding_transformers WHERE brand_id IS NULL) AS unmatched_brands,
      (SELECT count(*)::integer FROM welding_transformer_inspections WHERE transformer_id IS NULL) AS unmatched_transformers,
      (SELECT count(*)::integer FROM welding_transformer_inspections WHERE location_id IS NULL) AS unmatched_locations,
      (SELECT count(*)::integer FROM welding_transformers WHERE legacy_data = '{}'::jsonb) AS missing_master_source,
      (SELECT count(*)::integer FROM welding_transformer_inspections WHERE legacy_data = '{}'::jsonb) AS missing_inspection_source
    FROM welding_transformer_inspection_summary summary
  `);
  const row = result.rows[0];
  if (row.transformer_count !== 95 || row.inspection_count !== 5 || row.brand_count !== 6 || row.location_count !== 28) {
    throw new Error("Jumlah data Trafo tidak sesuai sumber.");
  }
  if (
    row.unmatched_brands || row.unmatched_transformers || row.unmatched_locations ||
    row.missing_master_source || row.missing_inspection_source
  ) throw new Error("Relasi atau metadata sumber Trafo tidak lengkap.");
  console.log(
    `Verifikasi Trafo Las: ${row.transformer_count} master, ${row.inspection_count} inspeksi pada ${row.inspected_transformer_count} trafo.`,
  );
  console.log(
    `Kondisi inspeksi: ${row.good_condition_count} bagus, ${row.damaged_condition_count} rusak; ${row.brand_count} merk dan ${row.location_count} lokasi.`,
  );
} finally {
  await client.end().catch(() => {});
}
