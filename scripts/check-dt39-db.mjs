import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

async function check() {
  const envContents = await readFile(path.join(process.cwd(), ".env"), "utf8");
  const envLine = envContents.split(/\r?\n/).find((line) => /^\s*DATABASE_URL\s*=/.test(line));
  if (!envLine) throw new Error("DATABASE_URL tidak ditemukan.");
  const connectionString = envLine
    .replace(/^\s*DATABASE_URL\s*=\s*/, "")
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");

  const client = new pg.Client({ connectionString });
  await client.connect();

  console.log("Searching for inspection of Truck Dump DT39 on 2026-07-06...");
  const inspRes = await client.query(`
    SELECT id, inspected_on, machine_category, machine_type, machine_name, schedule_code
    FROM maintenance_inspections
    WHERE lower(machine_name) LIKE '%dt39%' OR lower(machine_name) LIKE '%truck dump dt39%'
    ORDER BY inspected_on DESC
    LIMIT 5
  `);

  console.log("Inspections found:", inspRes.rows.length);
  for (const insp of inspRes.rows) {
    console.log(`\nInspection ID: ${insp.id}, Date: ${insp.inspected_on}, Category: ${insp.machine_category}, Type: ${insp.machine_type}, Name: ${insp.machine_name}, Code: ${insp.schedule_code}`);

    const checksRes = await client.query(`
      SELECT item.name, item.machine_category, item.sort_order, result.status, result.raw_status
      FROM maintenance_check_results result
      JOIN maintenance_check_items item ON item.id = result.item_id
      WHERE result.inspection_id = $1
      ORDER BY item.sort_order, item.name
    `, [insp.id]);

    console.log(`Check results count in DB: ${checksRes.rows.length}`);
    checksRes.rows.forEach((c, idx) => {
      console.log(`  #${idx + 1}: [${c.machine_category}] ${c.name} -> ${c.status} (${c.raw_status})`);
    });
  }

  await client.end();
}

check().catch(console.error);
