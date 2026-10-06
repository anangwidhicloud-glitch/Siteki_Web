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

  console.log("Checking DB for Perlengkapan Cat...");

  const mRes = await client.query("SELECT id, name FROM machines WHERE lower(name) LIKE '%perlengkapan cat%' OR lower(name) LIKE '%cat%'");
  console.log("Machines matching 'cat':", mRes.rows);

  const pRes = await client.query("SELECT id, machine_name FROM maintenance_plans WHERE lower(machine_name) LIKE '%perlengkapan cat%'");
  console.log("Plans matching 'perlengkapan cat':", pRes.rows.length);

  if (mRes.rows.length > 0) {
    await client.query("DELETE FROM machines WHERE lower(name) LIKE '%perlengkapan cat%'");
    console.log("Deleted Perlengkapan Cat from machines table.");
  }
  if (pRes.rows.length > 0) {
    await client.query("DELETE FROM maintenance_plans WHERE lower(machine_name) LIKE '%perlengkapan cat%'");
    console.log("Deleted Perlengkapan Cat from maintenance_plans table.");
  }

  await client.end();
}

run().catch(console.error);
