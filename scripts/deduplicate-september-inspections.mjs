import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;

function databaseUrl(contents) {
  const line = contents.split(/\r?\n/).find(value => /^\s*DATABASE_URL\s*=/.test(value));
  if (!line) throw new Error("DATABASE_URL tidak ditemukan.");
  return line.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
}

const env = await readFile(path.resolve(process.cwd(), ".env"), "utf8");
const client = new Client({ connectionString: databaseUrl(env) });
await client.connect();

try {
  console.log("Memeriksa duplikat maintenance_inspections...");
  const dupSummary = await client.query(`
    SELECT date_trunc('month', inspected_on)::date AS month, count(*)::integer AS total_count
    FROM maintenance_inspections
    GROUP BY date_trunc('month', inspected_on)::date
    ORDER BY month DESC
  `);
  console.log("Jumlah inspeksi per bulan sebelum pembersihan:", dupSummary.rows);

  const deleteResult = await client.query(`
    WITH duplicates AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY inspected_on, lower(btrim(machine_name))
               ORDER BY created_at DESC, id DESC
             ) AS rnum
      FROM maintenance_inspections
    )
    DELETE FROM maintenance_inspections
    WHERE id IN (
      SELECT id FROM duplicates WHERE rnum > 1
    )
    RETURNING id;
  `);

  console.log(`Berhasil menghapus ${deleteResult.rowCount} baris duplikat di maintenance_inspections.`);

  const afterSummary = await client.query(`
    SELECT date_trunc('month', inspected_on)::date AS month, count(*)::integer AS total_count
    FROM maintenance_inspections
    GROUP BY date_trunc('month', inspected_on)::date
    ORDER BY month DESC
  `);
  console.log("Jumlah inspeksi per bulan setelah pembersihan:", afterSummary.rows);
} catch (error) {
  console.error("Gagal membersihkan duplikat:", error);
} finally {
  await client.end();
}
