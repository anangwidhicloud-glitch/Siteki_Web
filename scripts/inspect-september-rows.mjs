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
  const res = await client.query(`
    SELECT source_sheet, machine_category, schedule_code, count(*)::integer AS count
    FROM maintenance_inspections
    WHERE inspected_on >= '2026-09-01' AND inspected_on <= '2026-09-30'
    GROUP BY source_sheet, machine_category, schedule_code
    ORDER BY count DESC
  `);
  console.log("Breakdown September 2026:", res.rows);

  const machinesCount = await client.query(`
    SELECT count(DISTINCT machine_name)::integer AS unique_machines, count(*)::integer AS total_inspections
    FROM maintenance_inspections
    WHERE inspected_on >= '2026-09-01' AND inspected_on <= '2026-09-30'
  `);
  console.log("Mesin unik & total inspeksi:", machinesCount.rows[0]);

  // Check how many planned inspections exist for September 2026
  const plans = await client.query(`
    SELECT count(*)::integer AS total_plans
    FROM maintenance_plans
    WHERE planned_on >= '2026-09-01' AND planned_on <= '2026-09-30'
  `);
  console.log("Rencana (planned) September 2026:", plans.rows[0]);

} catch (error) {
  console.error("Gagal inspect:", error);
} finally {
  await client.end();
}
