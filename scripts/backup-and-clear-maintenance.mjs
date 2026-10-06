import { readFile, writeFile, mkdir } from "node:fs/promises";
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

  console.log("Connected to Neon Database.");

  // 1. Create backup directory
  const backupDir = path.join(process.cwd(), ".deploy-backups");
  await mkdir(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFilePath = path.join(backupDir, `maintenance-tables-backup-${timestamp}.json`);

  console.log("=== LANGKAH 1: BACKUP DATA PERAWATAN ===");
  const [inspectionsRes, resultsRes, itemsRes] = await Promise.all([
    client.query("SELECT * FROM maintenance_inspections ORDER BY inspected_on DESC"),
    client.query("SELECT * FROM maintenance_check_results"),
    client.query("SELECT * FROM maintenance_check_items")
  ]);

  const backupData = {
    timestamp: new Date().toISOString(),
    counts: {
      maintenance_inspections: inspectionsRes.rows.length,
      maintenance_check_results: resultsRes.rows.length,
      maintenance_check_items: itemsRes.rows.length
    },
    maintenance_inspections: inspectionsRes.rows,
    maintenance_check_results: resultsRes.rows,
    maintenance_check_items: itemsRes.rows
  };

  await writeFile(backupFilePath, JSON.stringify(backupData, null, 2), "utf8");
  console.log(`Backup berhasil disimpan di: ${backupFilePath}`);
  console.log(`- Total maintenance_inspections: ${inspectionsRes.rows.length}`);
  console.log(`- Total maintenance_check_results: ${resultsRes.rows.length}`);
  console.log(`- Total maintenance_check_items: ${itemsRes.rows.length}`);

  console.log("\n=== LANGKAH 2: MENGOSONGKAN TABEL PERAWATAN ===");
  await client.query("BEGIN");
  await client.query("DELETE FROM maintenance_check_results");
  await client.query("DELETE FROM maintenance_inspections");
  // Also clean up non-master maintenance plans if needed, but keeping plans if requested
  await client.query("COMMIT");
  console.log("Penghapusan selesai!");

  console.log("\n=== LANGKAH 3: VERIFIKASI JUMLAH DATA SETELAH PENGOSONGAN ===");
  const [inspAfter, resAfter] = await Promise.all([
    client.query("SELECT count(*)::integer FROM maintenance_inspections"),
    client.query("SELECT count(*)::integer FROM maintenance_check_results")
  ]);

  console.log(`Sisa maintenance_inspections: ${inspAfter.rows[0].count}`);
  console.log(`Sisa maintenance_check_results: ${resAfter.rows[0].count}`);

  await client.end();
}

run().catch(console.error);
