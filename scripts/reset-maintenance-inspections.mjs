import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const BACKUP_DIR = path.resolve(process.cwd(), ".deploy-backups", "maintenance-reset-20260815");
const DATA_FILE = path.join(BACKUP_DIR, "maintenance-inspections-and-results.json.gz");
const MANIFEST_FILE = path.join(BACKUP_DIR, "manifest.json");
const CONFIRMATION = "DELETE_MAINTENANCE_INSPECTIONS_ONLY";

function databaseUrl(contents) {
  const line = contents.split(/\r?\n/).find(value => /^\s*DATABASE_URL\s*=/.test(value));
  if (!line) throw new Error("DATABASE_URL tidak ditemukan.");
  return line.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function counts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM maintenance_inspections) AS inspections,
      (SELECT count(*)::integer FROM maintenance_check_results) AS results,
      (SELECT count(*)::integer FROM maintenance_plans) AS plans,
      (SELECT count(*)::integer FROM maintenance_check_items) AS items,
      (SELECT count(*)::integer FROM maintenance_monthly_targets) AS targets,
      (SELECT count(*)::integer FROM machines) AS machines,
      (SELECT count(*)::integer FROM work_reports) AS work_reports,
      (SELECT count(*)::integer FROM work_orders) AS work_orders
  `);
  return result.rows[0];
}

const env = await readFile(path.resolve(process.cwd(), ".env"), "utf8");
const client = new Client({ connectionString: databaseUrl(env) });
await client.connect();

try {
  if (process.argv.includes("--backup")) {
    const before = await counts(client);
    if (!before.inspections || !before.results) throw new Error("Data perawatan kosong; backup dibatalkan.");
    const [inspections, results] = await Promise.all([
      client.query("SELECT * FROM maintenance_inspections ORDER BY inspected_on,id"),
      client.query("SELECT * FROM maintenance_check_results ORDER BY inspection_id,item_id"),
    ]);
    const payload = Buffer.from(JSON.stringify({
      backedUpAt: new Date().toISOString(),
      counts: before,
      inspections: inspections.rows,
      results: results.rows,
    }));
    const compressed = gzipSync(payload, { level: 9 });
    const manifest = {
      createdAt: new Date().toISOString(),
      file: path.basename(DATA_FILE),
      sha256: sha256(compressed),
      compressedBytes: compressed.length,
      counts: before,
    };
    await mkdir(BACKUP_DIR, { recursive: true });
    await writeFile(DATA_FILE, compressed);
    await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
    const restored = JSON.parse(gunzipSync(await readFile(DATA_FILE)).toString("utf8"));
    if (restored.inspections.length !== before.inspections || restored.results.length !== before.results) {
      throw new Error("Validasi isi backup gagal.");
    }
    console.log(JSON.stringify({ status:"backup-ok", directory:BACKUP_DIR, ...manifest }, null, 2));
  } else if (process.argv.includes("--clear")) {
    const confirmation = process.argv.find(value => value.startsWith("--confirm="))?.slice(10);
    if (confirmation !== CONFIRMATION) throw new Error("Konfirmasi penghapusan tidak cocok.");
    const manifest = JSON.parse(await readFile(MANIFEST_FILE, "utf8"));
    const compressed = await readFile(DATA_FILE);
    if (sha256(compressed) !== manifest.sha256) throw new Error("Checksum backup tidak cocok; penghapusan dibatalkan.");
    const restored = JSON.parse(gunzipSync(compressed).toString("utf8"));
    if (restored.inspections.length !== manifest.counts.inspections || restored.results.length !== manifest.counts.results) {
      throw new Error("Jumlah isi backup tidak cocok; penghapusan dibatalkan.");
    }
    const before = await counts(client);
    if (before.inspections !== manifest.counts.inspections || before.results !== manifest.counts.results) {
      throw new Error("Jumlah data Neon berubah setelah backup; penghapusan dibatalkan.");
    }
    await client.query("BEGIN");
    try {
      const deleted = await client.query("DELETE FROM maintenance_inspections RETURNING id");
      const after = await counts(client);
      for (const key of ["plans", "items", "targets", "machines", "work_reports", "work_orders"]) {
        if (after[key] !== before[key]) throw new Error(`Tabel pelindung berubah: ${key}.`);
      }
      if (after.inspections !== 0 || after.results !== 0) throw new Error("Riwayat perawatan belum kosong setelah penghapusan.");
      if (deleted.rowCount !== before.inspections) throw new Error("Jumlah inspeksi terhapus tidak cocok.");
      await client.query("COMMIT");
      console.log(JSON.stringify({ status:"clear-ok", deletedInspections:deleted.rowCount, cascadedResults:before.results, preserved:{
        plans:after.plans,items:after.items,targets:after.targets,machines:after.machines,
        workReports:after.work_reports,workOrders:after.work_orders,
      } }, null, 2));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } else {
    throw new Error("Gunakan --backup atau --clear dengan konfirmasi yang benar.");
  }
} finally {
  await client.end().catch(() => {});
}
