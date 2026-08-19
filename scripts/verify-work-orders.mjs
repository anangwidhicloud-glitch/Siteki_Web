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
      (SELECT count(*)::integer FROM work_orders WHERE legacy_sheet_row IS NULL) AS missing_source_rows,
      (SELECT count(*)::integer FROM work_orders WHERE legacy_data = '{}'::jsonb) AS missing_legacy_data,
      (SELECT count(*)::integer FROM work_orders WHERE source_name <> 'Order API') AS wrong_sources
    FROM work_order_summary summary
  `);
  const row = result.rows[0];
  if (row.total_orders !== 21 || row.open_orders + row.closed_orders !== row.total_orders) {
    throw new Error("Jumlah atau status Order Kerja tidak konsisten.");
  }
  if (row.unmatched_machines || row.missing_source_rows || row.missing_legacy_data || row.wrong_sources) {
    throw new Error("Relasi mesin atau metadata sumber Order Kerja tidak lengkap.");
  }
  console.log(
    `Verifikasi Order Kerja: ${row.total_orders} order (${row.open_orders} open, ${row.closed_orders} selesai), seluruhnya terhubung mesin.`,
  );
} finally {
  await client.end().catch(() => {});
}
