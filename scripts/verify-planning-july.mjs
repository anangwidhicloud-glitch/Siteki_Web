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

  console.log("=== CHECKING MAINTENANCE PLANS FOR JULY IN DATABASE ===");
  const plansJuly = await client.query(`
    SELECT count(*)::integer AS total_p
    FROM maintenance_plans
    WHERE planned_on >= '2026-07-01' AND planned_on <= '2026-07-31'
  `);
  console.log("Total Planned (P) in July 2026:", plansJuly.rows[0].total_p);

  console.log("\n=== CHECKING ALL MONTHS IN MAINTENANCE PLANS ===");
  const plansByMonth = await client.query(`
    SELECT date_trunc('month', planned_on)::date AS month, count(*)::integer AS total_p
    FROM maintenance_plans
    GROUP BY date_trunc('month', planned_on)::date
    ORDER BY month
  `);
  plansByMonth.rows.forEach(r => {
    console.log(`Month: ${new Date(r.month).toISOString().slice(0, 7)} -> Total Planned (P): ${r.total_p}`);
  });

  await client.end();
}

run().catch(console.error);
